// LD_PRELOAD shim that logs entry/exit of eglCreateImageKHR, eglDestroyImageKHR
// and eglMakeCurrent, with thread ID + monotonic timestamp + the EGL context
// current on that thread at call time. See ../../WEBKITGTK-NVIDIA-EGL-CRASH.md
// ("Source-level investigation") for what this is testing: whether GStreamer's
// gsteglimage.c calls eglCreateImageKHR from a different thread than the one
// that owns/uses the EGL context around the same moment, while eglDestroyImageKHR
// is already marshaled onto the owning thread via gst_gl_context_thread_add().
//
// Build:  ./build.sh
// Run:    ./run.sh "https://www.youtube.com/watch?v=jNQXAC9IVRw"
// Analyze: python3 analyze_egl_trace.py /tmp/egl_trace.log
//
// Intercepts both direct linkage (dlsym(RTLD_NEXT, ...) at load time) and
// eglGetProcAddress-based resolution (the more common path for KHR extension
// functions), so this works regardless of how GStreamer/WebKit obtained the
// function pointers.

#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <sys/syscall.h>
#include <pthread.h>
#include <EGL/egl.h>
#include <EGL/eglext.h>

typedef EGLImageKHR (*eglCreateImageKHR_t)(EGLDisplay, EGLContext, EGLenum, EGLClientBuffer, const EGLint *);
typedef EGLBoolean (*eglDestroyImageKHR_t)(EGLDisplay, EGLImageKHR);
typedef EGLBoolean (*eglMakeCurrent_t)(EGLDisplay, EGLSurface, EGLSurface, EGLContext);
typedef __eglMustCastToProperFunctionPointerType (*eglGetProcAddress_t)(const char *);
typedef EGLContext (*eglGetCurrentContext_t)(void);

static eglCreateImageKHR_t real_eglCreateImageKHR;
static eglDestroyImageKHR_t real_eglDestroyImageKHR;
static eglMakeCurrent_t real_eglMakeCurrent;
static eglGetProcAddress_t real_eglGetProcAddress;
static eglGetCurrentContext_t real_eglGetCurrentContext;

static FILE *log_fp;
static pthread_mutex_t log_mutex = PTHREAD_MUTEX_INITIALIZER;

static long now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000000000L + ts.tv_nsec;
}

static pid_t gettid_(void) {
    return (pid_t)syscall(SYS_gettid);
}

// CSV: ns,tid,event,function,dpy,ctx,extra
static void log_line(const char *event, const char *func, void *dpy, void *ctx, void *extra) {
    pthread_mutex_lock(&log_mutex);
    fprintf(log_fp, "%ld,%d,%s,%s,%p,%p,%p\n", now_ns(), gettid_(), event, func, dpy, ctx, extra);
    fflush(log_fp); // survive a SIGSEGV a few lines later
    pthread_mutex_unlock(&log_mutex);
}

static void ensure_init(void) {
    if (log_fp) return;
    const char *path = getenv("EGL_TRACE_LOG");
    if (!path) path = "/tmp/egl_trace.log";
    log_fp = fopen(path, "a");
    if (!log_fp) {
        // Fall back to stderr rather than silently losing the trace.
        log_fp = stderr;
    }
    setvbuf(log_fp, NULL, _IOLBF, 0);
    fprintf(log_fp, "# ns,tid,event,function,dpy,ctx,extra (extra: target/attrib_list ptr for create, current-ctx-arg for destroy, draw for makecurrent)\n");

    if (!real_eglCreateImageKHR)
        real_eglCreateImageKHR = (eglCreateImageKHR_t)dlsym(RTLD_NEXT, "eglCreateImageKHR");
    if (!real_eglDestroyImageKHR)
        real_eglDestroyImageKHR = (eglDestroyImageKHR_t)dlsym(RTLD_NEXT, "eglDestroyImageKHR");
    if (!real_eglMakeCurrent)
        real_eglMakeCurrent = (eglMakeCurrent_t)dlsym(RTLD_NEXT, "eglMakeCurrent");
    if (!real_eglGetCurrentContext)
        real_eglGetCurrentContext = (eglGetCurrentContext_t)dlsym(RTLD_NEXT, "eglGetCurrentContext");
}

__attribute__((constructor))
static void init(void) {
    ensure_init();
}

// current-context helper: what EGL context is bound on THIS thread right now.
// This is what lets the analysis script correlate a create/destroy call to a
// context even for eglDestroyImageKHR, which doesn't take a context argument.
static EGLContext current_ctx_safe(void) {
    if (real_eglGetCurrentContext) return real_eglGetCurrentContext();
    return (EGLContext)0;
}

EGLImageKHR eglCreateImageKHR(EGLDisplay dpy, EGLContext ctx, EGLenum target,
                               EGLClientBuffer buffer, const EGLint *attrib_list) {
    ensure_init();
    log_line("ENTER", "eglCreateImageKHR", (void *)dpy, (void *)ctx, (void *)(intptr_t)target);
    EGLImageKHR result = real_eglCreateImageKHR(dpy, ctx, target, buffer, attrib_list);
    log_line("EXIT", "eglCreateImageKHR", (void *)dpy, (void *)ctx, (void *)result);
    return result;
}

EGLBoolean eglDestroyImageKHR(EGLDisplay dpy, EGLImageKHR image) {
    ensure_init();
    EGLContext cur = current_ctx_safe();
    log_line("ENTER", "eglDestroyImageKHR", (void *)dpy, (void *)cur, (void *)image);
    EGLBoolean result = real_eglDestroyImageKHR(dpy, image);
    log_line("EXIT", "eglDestroyImageKHR", (void *)dpy, (void *)cur, (void *)(intptr_t)result);
    return result;
}

EGLBoolean eglMakeCurrent(EGLDisplay dpy, EGLSurface draw, EGLSurface read, EGLContext ctx) {
    ensure_init();
    log_line("ENTER", "eglMakeCurrent", (void *)dpy, (void *)ctx, (void *)draw);
    EGLBoolean result = real_eglMakeCurrent(dpy, draw, read, ctx);
    log_line("EXIT", "eglMakeCurrent", (void *)dpy, (void *)ctx, (void *)(intptr_t)result);
    return result;
}

// Extension functions like eglCreateImageKHR/eglDestroyImageKHR are commonly
// resolved via eglGetProcAddress rather than linked directly. Intercept that
// path too and hand back our wrappers instead of the real pointers.
__eglMustCastToProperFunctionPointerType eglGetProcAddress(const char *procname) {
    ensure_init();
    if (!real_eglGetProcAddress)
        real_eglGetProcAddress = (eglGetProcAddress_t)dlsym(RTLD_NEXT, "eglGetProcAddress");
    __eglMustCastToProperFunctionPointerType real =
        real_eglGetProcAddress ? real_eglGetProcAddress(procname) : NULL;
    if (!real || !procname) return real;

    if (strcmp(procname, "eglCreateImageKHR") == 0) {
        real_eglCreateImageKHR = (eglCreateImageKHR_t)real;
        return (__eglMustCastToProperFunctionPointerType)eglCreateImageKHR;
    }
    if (strcmp(procname, "eglDestroyImageKHR") == 0) {
        real_eglDestroyImageKHR = (eglDestroyImageKHR_t)real;
        return (__eglMustCastToProperFunctionPointerType)eglDestroyImageKHR;
    }
    return real;
}

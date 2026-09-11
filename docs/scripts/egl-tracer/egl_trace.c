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

// Re-entrancy guard: if real_eglCreateImageKHR/real_eglDestroyImageKHR ever
// end up aliased back to our own wrapper (seen with eglMakeCurrent — see the
// comment above the dlsym() interposer), this stops a silent stack-overflow
// loop and instead makes the mistake visible as one obvious log line.
static __thread int in_wrapper = 0;

EGLImageKHR eglCreateImageKHR(EGLDisplay dpy, EGLContext ctx, EGLenum target,
                               EGLClientBuffer buffer, const EGLint *attrib_list) {
    ensure_init();
    if (in_wrapper) {
        log_line("REENTRANT", "eglCreateImageKHR", (void *)dpy, (void *)ctx, NULL);
        return real_eglCreateImageKHR(dpy, ctx, target, buffer, attrib_list);
    }
    in_wrapper = 1;
    log_line("ENTER", "eglCreateImageKHR", (void *)dpy, (void *)ctx, (void *)(intptr_t)target);
    EGLImageKHR result = real_eglCreateImageKHR(dpy, ctx, target, buffer, attrib_list);
    log_line("EXIT", "eglCreateImageKHR", (void *)dpy, (void *)ctx, (void *)result);
    in_wrapper = 0;
    return result;
}

EGLBoolean eglDestroyImageKHR(EGLDisplay dpy, EGLImageKHR image) {
    ensure_init();
    if (in_wrapper) {
        log_line("REENTRANT", "eglDestroyImageKHR", (void *)dpy, NULL, (void *)image);
        return real_eglDestroyImageKHR(dpy, image);
    }
    in_wrapper = 1;
    EGLContext cur = current_ctx_safe();
    log_line("ENTER", "eglDestroyImageKHR", (void *)dpy, (void *)cur, (void *)image);
    EGLBoolean result = real_eglDestroyImageKHR(dpy, image);
    log_line("EXIT", "eglDestroyImageKHR", (void *)dpy, (void *)cur, (void *)(intptr_t)result);
    in_wrapper = 0;
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

// WebKitGTK's PlatformDisplay dlopen()s "libEGL.so.1" itself (confirmed via
// `strings libwebkit2gtk-4.1.so.0`: the string "Could not dlopen native EGL:"
// sits directly next to "libEGL.so.1") and resolves EGL entry points via
// dlsym() against that private handle. Handle-scoped dlsym only searches the
// target library's own export table, so it never sees a preloaded global
// symbol — LD_PRELOAD alone is blind to this path. Interposing dlsym itself
// closes the gap: whatever handle the caller resolves against, hand back our
// wrapper instead.
//
// eglMakeCurrent is deliberately NOT handled here (only via direct linkage /
// eglGetProcAddress above). A first attempt that also intercepted it here
// produced ~174k identical, no-op-returning eglMakeCurrent ENTER events in
// under 200ms on a single thread before the process died in libc, not
// libnvidia-eglcore as documented — a self-recursion artifact of this shim,
// not the real bug (glvnd's dispatch layer appears to re-resolve
// eglMakeCurrent through dlsym internally on this driver; interposing it
// here fed the shim's own wrapper back in as "the real one"). Since
// eglMakeCurrent isn't needed to test the create/destroy race hypothesis
// (destroy's owning context comes from eglGetCurrentContext, not from
// snooping makeCurrent calls), the safe fix is to leave it uninterposed here
// rather than chase glvnd's internal resolution order further.
typedef void *(*dlsym_t)(void *, const char *);
static dlsym_t real_dlsym;

static void ensure_real_dlsym(void) {
    if (real_dlsym) return;
    // Can't use dlsym(RTLD_NEXT, "dlsym") to find dlsym itself — that would
    // recurse into this same function. dlvsym sidesteps it: it is a distinct
    // libdl entry point not routed through our dlsym interposer.
    real_dlsym = (dlsym_t)dlvsym(RTLD_NEXT, "dlsym", "GLIBC_2.2.5");
}

void *dlsym(void *handle, const char *symbol) {
    ensure_real_dlsym();
    ensure_init();
    if (symbol) {
        if (strcmp(symbol, "eglCreateImageKHR") == 0) {
            if (!real_eglCreateImageKHR)
                real_eglCreateImageKHR = (eglCreateImageKHR_t)real_dlsym(handle, symbol);
            return (void *)eglCreateImageKHR;
        }
        if (strcmp(symbol, "eglDestroyImageKHR") == 0) {
            if (!real_eglDestroyImageKHR)
                real_eglDestroyImageKHR = (eglDestroyImageKHR_t)real_dlsym(handle, symbol);
            return (void *)eglDestroyImageKHR;
        }
    }
    return real_dlsym(handle, symbol);
}

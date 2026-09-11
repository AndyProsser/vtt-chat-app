# Draft: eglDestroyContext() segfault in libnvidia-eglcore (580 branch), during ordinary GL context teardown — likely same class as bug 5701801

**Target:** https://forums.developer.nvidia.com/ (Linux Graphics category) — referencing existing bug 5701801
**Status:** draft, not yet filed. Reviewed backtraces and source at `vtt-chat-app/docs/WEBKITGTK-NVIDIA-EGL-CRASH.md` (see "Symbolized backtraces (2026-09-11)").

---

## Summary

`eglDestroyContext()` segfaults inside `libnvidia-eglcore.so` when called immediately after `eglMakeCurrent(dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT)` on the same context, on the 580 driver branch. This is an ordinary, unexceptional context-unbind-then-destroy sequence — the calling application (WebKitGTK) isn't doing anything unusual here.

This looks like the same fault class NVIDIA engineer "amrits" already acknowledged in [bug 5701801](https://forums.developer.nvidia.com/t/libnvidia-glvkspirv-egl-core-regression-on-580-105-08-crashes-fractal-when-playing-videos-or-gifs/352749) (filed against Fractal, a different GTK app). This report adds a second, independently-reproduced application and — unlike the Fractal report — a symbolized caller-side stack pinpointing the exact call.

## Environment

- Driver: NVIDIA proprietary, confirmed on both **580.173.02** and **580.178.04** — the bug spans at least this range of the 580 branch, roughly two months apart in release dates.
- GPU: GeForce GTX 1080 (GP104, Pascal)
- Kernel: 7.0.0-31-generic (Ubuntu 26.04 LTS)
- Session: reproduces under both Wayland and X11 (`GDK_BACKEND=x11`)
- Triggering application: WebKitGTK 2.52.6 (`webkit2gtk-4.1`), via stock `MiniBrowser` — no custom app code

## Reproduction

```bash
/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser "https://www.youtube.com/watch?v=jNQXAC9IVRw"
```

Segfaults within roughly 5-10 seconds. **Caveat: this reproduction is not yet isolated to a minimal EGL-only test case** — it currently requires the full WebKitGTK browser and this specific page. The exact trigger condition inside WebKitGTK that leads to this context teardown hasn't been narrowed further than "an ordinary process-shutdown path." If a minimal standalone EGL reproducer (create context, `eglMakeCurrent(..., EGL_NO_CONTEXT)`, `eglDestroyContext`) is written and also crashes, that would confirm this is a general driver bug independent of WebKit; that test has not been run yet as of this writing.

## Caller-side backtrace (gdb, WebKitGTK-side frames resolved via `-dbgsym`; NVIDIA frames unresolved — proprietary)

```
Program terminated with signal SIGSEGV, Segmentation fault.
#0  0x0000709ed185f05f in ??? () from libnvidia-eglcore.so.580.178.04     <-- fault
#1  0x0000709ed1555e81 in ??? () from libnvidia-eglcore.so.580.178.04
#2  0x0000709ed158ba06 in ??? () from libnvidia-eglcore.so.580.178.04
#3  0x0000709ed158cd1f in ??? () from libnvidia-eglcore.so.580.178.04
#4  0x0000709ed155c068 in ??? () from libnvidia-eglcore.so.580.178.04
#5  0x0000709ed1549411 in ??? () from libnvidia-eglcore.so.580.178.04
#6  0x0000709ed1847328 in ??? () from libnvidia-eglcore.so.580.178.04
#7  0x0000709ed182369d in ??? () from libnvidia-eglcore.so.580.178.04
#8  0x0000709f40a250fd in ??? () from libEGL_nvidia.so.0
#9  0x0000709f40a251d2 in ??? () from libEGL_nvidia.so.0
#10 0x0000709f40a25b55 in ??? () from libEGL_nvidia.so.0
#11 0x0000709f40a2c486 in ??? () from libEGL_nvidia.so.0
#12 0x0000709f4bd38277 in WebCore::GLContext::~GLContext() () at Source/WebCore/platform/graphics/egl/GLContext.cpp:335
```

Frame 12, the caller-side code that triggered the fault, is:

```cpp
GLContext::~GLContext()
{
    if (auto display = m_display.get()) {
        EGLDisplay eglDisplay = display->eglDisplay();
        if (m_context) {
            eglMakeCurrent(eglDisplay, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
            eglDestroyContext(eglDisplay, m_context);   // <-- line 335, the crash site
        }
        ...
```

i.e. `eglMakeCurrent()` to unbind, then `eglDestroyContext()` on the same context — a completely standard teardown pattern.

## Additional notes

- No `NVRM: Xid` kernel message accompanies the crash (checked via `journalctl -k` across multiple repro runs) — this rules out a kernel-visible GPU-level event (hung engine, MMU fault, ECC error, thermal/watchdog reset). It's a plain userspace SIGSEGV inside the closed-source EGL library, consistent with a fixable userspace bug (bad pointer / use-after-free / corrupted internal state) rather than a hardware fault.
- The fault address and offsets are **exactly reproducible** across at least 4-5 separate runs at a fixed WebKitGTK+driver version (`libnvidia-eglcore.so.580.178.04[a5f05f,...]` every time) — this is not a flaky/timing-sensitive crash at a given build+driver combination, which should make it straightforward to reproduce internally.
- A [different application (Fractal) hitting what looks like the same fault class](https://forums.developer.nvidia.com/t/libnvidia-glvkspirv-egl-core-regression-on-580-105-08-crashes-fractal-when-playing-videos-or-gifs/352749) was acknowledged by NVIDIA engineer "amrits" on 2025-11-28, tracked as bug 5701801. As of driver 580.178.04 (latest 580.x point release checked), the branch has not moved since that acknowledgment in a way that appears to fix this (580.159.03/.04 → 580.167.08 → 580.173.02 → 580.178.04, no EGL/video-related changelog entries found).
- **Why this matters beyond a typical driver bug:** [580 is the last driver branch supporting Maxwell, Pascal, and Volta GPUs](https://www.phoronix.com/news/NVIDIA-580-Linux-Driver-Last-HW) — affected users cannot work around this by upgrading to 590/595/610, since those branches don't support this hardware at all.

## Full investigation writeup

A much more detailed writeup — including WebKitGTK-side bisection across ~13 toggles (all ruled out except which EGL vendor library loads), a positive control confirming this is crash-free on Intel GPU with an identical WebKitGTK build, and two evaluated mitigations (Mesa software EGL, zink-over-Vulkan) with their own trade-offs — is available on request (internal doc, not yet public). Happy to share if useful for triage, or to run additional diagnostics on request (this hardware is available for continued testing).

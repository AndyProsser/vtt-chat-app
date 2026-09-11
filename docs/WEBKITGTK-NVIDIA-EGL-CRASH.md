# WebKitGTK segfaults on NVIDIA 580 when pages play video (2.52.3 through 2.52.6, confirmed)

**Status:** root cause narrowed to the EGL vendor library, and confirmed NVIDIA-specific — the identical WebKitGTK build and reproduction pages run clean on Intel GPU, see [Positive control](#positive-control-intel-gpu-2026-08-19). **Update 2026-09-11: both crash signatures now have fully symbolized backtraces** (see [Symbolized backtraces](#symbolized-backtraces-2026-09-11)), and they supersede the earlier `gsteglimage.c` create/destroy-race hypothesis — GStreamer is not implicated by any evidence gathered so far. Signature 2 is a SIGSEGV inside NVIDIA's own `eglDestroyContext()`, called from WebKit's `GLContext::~GLContext()` while tearing down a page's GL context; signature 1 is a distinct WebKit-side null-pointer bug in `AcceleratedBackingStore::update()`. Working theory for how they connect: signature 1 kills the UI process, which severs the IPC connection to the WebProcess, which reacts by self-terminating — and it's during *that* teardown that `eglDestroyContext()` crashes. Two configurations prevent the crash on NVIDIA, each with a significant trade-off — see [Mitigations evaluated](#mitigations-evaluated). NVIDIA has acknowledged an equivalent regression internally (bug 5701801, unresolved) — see [Corroboration](#corroboration). Filed here for upstream (WebKitGTK, Tauri, NVIDIA).
**Investigated:** 2026-08-09, updated 2026-08-11, 2026-08-19, 2026-09-11
**Reporter context:** hit while building a Tauri 2 app that hosts D&D Beyond in a WebKitGTK WebView. Reproduces in stock WebKitGTK browsers with no app code involved.

## Summary

On an NVIDIA 580-branch proprietary driver, WebKitGTK 2.52.3 reliably segfaults on certain pages that play video. Of thirteen single-variable interventions tried, the **only** ones that prevent it change which EGL vendor library libglvnd loads — every WebKit-level and GStreamer-level toggle still crashes.

The crash is **not** codec-related, despite looking like it at first. Forcing software video decode does not help; hardware NVDEC decoding works fine in the configuration that doesn't crash.

That EGL-vendor switch comes at a steep cost: it prevents the crash but leaves WebKit unable to initialise a working render path, at ~0.2 FPS. Routing GL over NVIDIA's Vulkan driver via zink restores full speed and also avoids the crash, but breaks `<video>` frame import. Neither is a general fix, though the first is a reasonable trade for some applications — see [Mitigations evaluated](#mitigations-evaluated).

Affects `webkit2gtk-4.1` (GTK3), `webkitgtk-6.0` (GTK4), and Epiphany 49.2 alike.

## Environment

|           |                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| OS        | Ubuntu 26.04 LTS (resolute), kernel 7.0.0-29-generic                                                                                   |
| WebKitGTK | 2.52.3 (`2.52.3-0ubuntu0.26.04.3`), both `webkit2gtk-4.1` and `webkitgtk-6.0`                                                          |
| GPU       | NVIDIA GeForce GTX 1080 (GP104, Pascal)                                                                                                |
| Driver    | NVIDIA proprietary 580.173.02 (`nvidia-driver-580`)                                                                                    |
| Session   | Wayland (GNOME). Also reproduced under `GDK_BACKEND=x11`                                                                               |
| GStreamer | 1.28.2                                                                                                                                 |
| libva     | VA-API non-functional (`nvidia_drv_video.so` fails to load) — normal for this driver without `nvidia-vaapi-driver`, and not implicated |

As of 2026-09-11, reconfirmed on the same machine after an ordinary Ubuntu update: WebKitGTK **2.52.6** (`2.52.6-0ubuntu0.26.04.1`) and NVIDIA driver **580.178.04** — both newer than the versions above, crash unchanged. See [Symbolized backtraces](#symbolized-backtraces-2026-09-11).

## Reproduction

Minimal, no app code:

```bash
/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser "https://www.youtube.com/watch?v=jNQXAC9IVRw"
```

Segfaults within roughly 5–10 seconds. Same result with:

```bash
/usr/lib/x86_64-linux-gnu/webkitgtk-6.0/MiniBrowser "https://www.youtube.com/watch?v=jNQXAC9IVRw"
epiphany --private-instance "https://www.youtube.com/watch?v=jNQXAC9IVRw"
```

Confirmed on two different YouTube watch URLs and on `https://www.dndbeyond.com/` (which has autoplaying background video).

**Does not crash:** the YouTube homepage, YouTube Shorts, and — importantly — the YouTube **embed** player (`/embed/<id>?autoplay=1&mute=1`) playing the _same video_.

## What crashes

The crash signature varies between runs. Both of these were observed on the same URL, with no debug symbols available (see [Getting better data](#getting-better-data)):

**1. UI process** — the consistent one. Seen in 4 of 4 runs, at a stable address inside `libwebkit2gtk`, with no NVIDIA frames on the stack:

```text
Program terminated with signal SIGSEGV.
#0  0x00007cf371fd09c2 in ?? () from libwebkit2gtk-4.1.so.0
#1  ...                          libwebkit2gtk-4.1.so.0
...
#10 libjavascriptcoregtk-4.1.so.0
#13 libglib-2.0.so.0
#15 g_main_context_iteration ()
#16 g_application_run ()
```

**2. `WebKitWebProcess`** — seen in some runs, crashing _inside the NVIDIA driver_:

```text
Core was generated by `WebKitWebProcess 5 58'.
Program terminated with signal SIGSEGV.
#0  libnvidia-eglcore.so.580.173.02      <-- fault
#1..#7  libnvidia-eglcore.so.580.173.02
#8..#11 libEGL_nvidia.so.0
#12 libwebkit2gtk-4.1.so.0
#13 libwebkit2gtk-4.1.so.0
...
#26 WTF::RunLoop::run()
```

Signature 2 is what points at the driver. Signature 1 may be a consequence of the same underlying state (a texture/EGLImage invalidated by the driver, then used by WebKit) — that is inference, not established.

## Bisection

Each row is a single-variable change against the same crashing URL.

### Prevents the crash

Both carry trade-offs — see [Mitigations evaluated](#mitigations-evaluated).

| Change                                                                                                                | Result                                                 |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json`                                           | no crash, but UI drops to 0.2 FPS                      |
| the above + `MESA_LOADER_DRIVER_OVERRIDE=zink VK_DRIVER_FILES=…/nvidia_icd.json WEBKIT_DMABUF_RENDERER_DISABLE_GBM=1` | no crash, full speed, but `<video>` presents no frames |

### Does not fix it

| Change                                                     | Result   |
| ---------------------------------------------------------- | -------- |
| `WEBKIT_DISABLE_DMABUF_RENDERER=1`                         | segfault |
| `WEBKIT_DISABLE_COMPOSITING_MODE=1`                        | segfault |
| `WEBKIT_GST_DISABLE_GL_SINK=1`                             | segfault |
| `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`                       | segfault |
| `WEBKIT_DMABUF_RENDERER_DISABLE_GBM=1`                     | segfault |
| `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1`                       | segfault |
| `GDK_BACKEND=x11`                                          | segfault |
| `GST_PLUGIN_FEATURE_RANK=nvvp9dec:0` (forces software VP9) | segfault |
| `__GL_SHADER_DISK_CACHE=0 __GL_PIPELINE_CACHE=0`           | segfault |
| `LIBGL_ALWAYS_SOFTWARE=1` alone                            | segfault |
| unsetting `GBM_BACKEND=nvidia-drm`                         | segfault |

`LIBGL_ALWAYS_SOFTWARE=1` alone failing while the Mesa EGL vendor switch succeeds is the key discriminator: it is **which EGL vendor library libglvnd loads**, not hardware-versus-software rendering.

## What it is not

Ruled out by experiment:

- **Not the codec or decoder.** Forcing software VP9 (`nvvp9dec` deranked, `vp9dec` used instead) still crashed. In the working Mesa-EGL configuration, GStreamer still instantiates `nvvp9dec` and hardware decoding proceeds normally with zero GStreamer errors.
- **Not HTML5 video generally.** Local `<video>` playback is fine: H.264/mp4 and VP9/WebM, at 720p, 1440p and 4K; six simultaneous videos on one page; MSE; `canvas.drawImage(video)` in a rAF loop; `gl.texImage2D(…, video)` WebGL upload. None crash.
- **Not MSE.** The YouTube embed player uses MSE with the same VP9 stream and does not crash.
- **Not resolution or pipeline count.** See above.
- **Not the NVIDIA shader/pipeline disk cache.** Disabling both still crashes.
- **Not an image-codec (AVIF/WebP) decode issue.** This was an earlier working theory in this project, now disproved — the Mesa EGL switch fixes the crash with image handling untouched.

**Necessary but not sufficient:** every crashing page plays video, but playing video is not enough on its own (the embed player does, and is fine). The precise DOM/compositing condition on a YouTube watch page that trips it is **not identified**.

## Root cause assessment

**Updated 2026-09-11 — see [Symbolized backtraces](#symbolized-backtraces-2026-09-11) for the full evidence.** This is now believed to be two separate defects that fire back-to-back, not one:

1. A likely **WebKitGTK bug**: `AcceleratedBackingStore::update()` is called with a null backing-store pointer while the UI process handles an `EnterAcceleratedCompositingMode` IPC message — a plain null-pointer crash with no driver involvement. This is what actually crashes first (signature 1).
2. An **NVIDIA driver bug**: `eglDestroyContext()` segfaults inside `libnvidia-eglcore`, called from WebKit's `GLContext::~GLContext()` during the WebProcess's graceful self-shutdown that follows losing its IPC connection to the (now-crashed) UI process (signature 2).

The EGL-vendor-library dependency established below (eleven single-variable tests, only the vendor library matters) and the Intel-GPU negative control still stand as real findings — they explain why signature 2 needs NVIDIA specifically. What's changed is the *mechanism*: this is not GL work performed while compositing a video-playing page, and it is not related to `eglCreateImageKHR`/`eglDestroyImageKHR` or DMA-BUF image import in any way evidence has shown. It's an ordinary context-teardown call, reached via an ordinary process-shutdown path, that happens to run soon after signature 1 kills the UI process. Whether signature 1 is reachable on non-NVIDIA hardware (which would make it a pure WebKitGTK bug, unmasked here only because signature 2 fires first on this hardware) is the most valuable open question — see [Open questions](#open-questions).

## Corroboration

- **NVIDIA has an open internal bug for the same regression class.** A [reported 580-branch `libnvidia-eglcore`/`libnvidia-glvkspirv` regression](https://forums.developer.nvidia.com/t/libnvidia-glvkspirv-egl-core-regression-on-580-105-08-crashes-fractal-when-playing-videos-or-gifs/352749) crashes the GTK app Fractal when playing videos or GIFs — same library, same class of trigger, different application. NVIDIA engineer "amrits" confirmed on 2025-11-28: _"There are multiple threads opened for similar crash, and I have filed a bug 5701801 for tracking purpose."_ No fix has landed as of 580.173.02, the latest 580.x point release as of this writing — the branch has not moved since (580.65.06 → 580.82.07 → 580.95.05 → 580.105.08 → 580.126.09/.18/.20 → 580.159.03/.04 → 580.167.08 → 580.173.02 → 580.178.04), and none of those changelogs mention an EGL/video fix.
- **A different WebKitGTK crash on NVIDIA 580 was fixed by leaving the 580 branch entirely.** A [GNOME Discourse report](https://discourse.gnome.org/t/webkitwebprocess-crashed-when-displaying-the-message/31320) of `WebKitWebProcess` crashing in Evolution (libwebkit2gtk 2.48.5) on 580.75.06/580.82.07 was resolved by downgrading to **550.144.03** — not just a different 580.x point release, but off the 580 branch altogether. This is a stronger, previously-untested lead than the 580.142-vs-580.173.02 question below: 550.144.03 predates the 580-branch regression window entirely and still supports Pascal (580 is only the _last_ branch to support Maxwell/Pascal/Volta, not the only one).
- **A superficially similar WebKit bug is a red herring.** [WebKit Bugzilla #297921](https://bugs.webkit.org/show_bug.cgi?id=297921) ("`[GTK] EGL_BAD_PARAMETER` crash") looked related but is not: it's an `abort()` in `PlatformDisplayDefault::create()` on **Intel** GPUs (Arc B580, Iris Xe) at web-process startup, unrelated to NVIDIA or video playback. Ruled out, not pursued further.

**Why this matters more than a typical driver bug:** [580 is the last branch supporting Maxwell, Pascal and Volta](https://www.phoronix.com/news/NVIDIA-580-Linux-Driver-Last-HW). Affected users cannot upgrade to 590/595/610 — those branches do not drive their GPUs. Every GTX 900/10-series Linux user on WebKitGTK is stuck on the affected branch. Ubuntu 26.04 also ships an older `580.142` in `resolute/restricted` (vs. `580.173.02` in `-updates`); whether that point release predates the regression is **untested**.

## Mitigations evaluated

Two configurations prevent the crash. Neither is a general-purpose fix, but which trade-off is acceptable depends entirely on the application — see [Choosing between them](#choosing-between-them). All numbers below are from the same harness: a page animating a CSS transform under `requestAnimationFrame`, FPS averaged over 8s, run in `MiniBrowser` on the machine described above.

| Config                                                                     | UI FPS (page with no video) | Video                   | Crash                   |
| -------------------------------------------------------------------------- | --------------------------- | ----------------------- | ----------------------- |
| NVIDIA EGL (stock)                                                         | 62                          | plays, 0 frames dropped | segfaults on some pages |
| Mesa EGL (`__EGL_VENDOR_LIBRARY_FILENAMES` → `50_mesa.json`)               | **0.2**                     | decodes, but UI frozen  | none                    |
| Mesa EGL + zink over NVIDIA Vulkan (`VK_DRIVER_FILES` → `nvidia_icd.json`) | 62                          | **0 frames presented**  | none                    |

**Mesa EGL** stops the crash but does not degrade gracefully — it never gets a working path on this device:

```text
libEGL warning: pci id for fd 22: 10de:1b80, driver (null)
libEGL warning: DRI2: failed to create screen
libEGL warning: egl: failed to create dri2 screen
```

`LIBGL_ALWAYS_SOFTWARE=1` and `GALLIUM_DRIVER=llvmpipe` produce identical 0.3 FPS results, so this is not simply "llvmpipe is slow". Hardware video _decoding_ does survive (GStreamer still uses `nvvp9dec`, frames decode with none dropped) — but the UI is unusable, so it does not matter. One caveat: this measurement cannot fully distinguish "rendering is ~300× slower" from "WebKit throttled `requestAnimationFrame` because compositing never initialised". The comparison is like-for-like, but the mechanism is unconfirmed.

**zink over NVIDIA Vulkan** is the more interesting result, and may be the most useful datapoint here for WebKit maintainers. Routing GL through NVIDIA's Vulkan driver (`libGLX_nvidia.so.0`) instead of its EGL/GL stack **restores full UI performance and avoids the crash entirely** — 62 FPS, clean on both YouTube watch pages and the DDB homepage across repeated runs. It requires `WEBKIT_DMABUF_RENDERER_DISABLE_GBM=1`, since GBM otherwise fails to pair with Mesa EGL (`Could not create GBM EGL display: EGL_NOT_INITIALIZED`). But it breaks video import:

```text
Failed to create EGL image from DMABuf of size 1024x730
Failed to create EGL image for texture
MESA: error: zink: couldn't allocate memory: heap=0 size=3145728
```

Any page containing a `<video>` element drops to ~1.5 FPS and presents zero video frames. So the same DMA-BUF → EGLImage import path that is implicated in the crash is also what fails under zink — which may point at where the underlying problem lives.

### Choosing between them

The right choice depends on what the application needs, and the Mesa EGL route is genuinely usable for a large class of apps:

- **Needs smooth rendering or video** (this project: a WebRTC client hosting a rich site) — neither option works. Avoid the crash-triggering _content_ instead. In this project's case the app's real pages (`dndbeyond.com/characters`) do not crash under stock NVIDIA EGL; only the marketing homepage and YouTube-watch-style pages do, and a navigation-level redirect already prevents loading them.
- **Mostly static content, no video, animation not important** (kiosks, dashboards, documentation viewers, config UIs, embedded panels) — **`__EGL_VENDOR_LIBRARY_FILENAMES` → Mesa is a reasonable trade.** It reliably removes the crash, and an app that never animates will not notice the compositing cost the way an animation benchmark does. Worth measuring against your own UI rather than assuming either way.
- **Needs UI performance but not `<video>`** — the zink route gives full speed with no crash. Viable if you can guarantee no video elements, though the failure mode if one appears is severe (~1.5 FPS, no frames).

An important caveat on the 0.2 FPS figure: it measures `requestAnimationFrame` throughput, which is the right metric for animation but not necessarily for input latency or one-shot page rendering. It has not been established whether this is "rendering is ~300× slower" or "WebKit throttled rAF because compositing never initialised". Applications in the second category above should benchmark their own workload before ruling the Mesa route out.

Two driver-downgrade avenues remain untested, and are the only known routes to both no-crash and full performance:

- `580.142` (Ubuntu's `resolute/restricted` point release) — may predate the regression while staying on the 580 branch.
- `550.144.03` — off the 580 branch entirely, and the version [confirmed to fix a related WebKitGTK/NVIDIA EGL crash](#corroboration) for another user. Since 580.105.08 (already affected) is close to the start of the 580 branch (580.65.06), a same-branch downgrade has less room to land before the regression than dropping to 550 does — make 550.144.03 the first one tried.

## Suggested action per project

**Updated 2026-09-11:** with both crashes now symbolized (see [Symbolized backtraces](#symbolized-backtraces-2026-09-11)), the two signatures point at two different projects rather than one shared root cause.

**WebKitGTK** — two separate, concrete, line-numbered reports:

1. **Signature 1 (likely the primary bug):** `AcceleratedBackingStore::update()` (`Source/WebKit/UIProcess/gtk/AcceleratedBackingStore.cpp:808`) dereferences a null `this` while handling `Messages::DrawingAreaProxy::EnterAcceleratedCompositingMode`, reached via `WebPageProxy::enterAcceleratedCompositingMode()` (`WebPageProxy.cpp:12800`) → `DrawingAreaProxyCoordinatedGraphics::enterAcceleratedCompositingMode()` (`DrawingAreaProxyCoordinatedGraphics.cpp:230/261`). This is a plain null-pointer crash, no GPU vendor involved on this stack — worth filing regardless of what triggers signature 2, since a crashed/killed WebProcess sending a stale or racing IPC message looks like exactly the kind of thing a hostile or buggy renderer could trigger deliberately, independent of NVIDIA.
2. **Signature 2, as a robustness report even if the true fault is NVIDIA's:** `GLContext::~GLContext()` (`GLContext.cpp:335`) calls `eglDestroyContext()` unconditionally during process teardown, and on this driver that call itself segfaults, taking the whole process down mid-shutdown rather than exiting cleanly. Worth asking whether WebKit could catch/tolerate a failing driver call here (e.g. skip cleanup during an already-in-progress abnormal shutdown) so a driver bug degrades to "process exits" rather than "process segfaults."

**NVIDIA** — `eglDestroyContext()`, called immediately after `eglMakeCurrent(dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT)` on the same context, segfaults inside `libnvidia-eglcore` (frames unresolved — proprietary). This is a narrower, more mechanical claim than the doc's earlier "GL work while compositing video" framing, and much closer to what's actually needed for a useful report: an ordinary context-unbind-then-destroy sequence. NVIDIA has already opened [internal bug 5701801](#corroboration) for what looks like the same regression class (reported against Fractal, not WebKitGTK) — worth referencing that bug number directly when filing. Confirming this with a minimal non-WebKit EGL reproducer (see [Open questions](#open-questions)) before filing would make the report much stronger — a driver bug demonstrated in 20 lines of C is far harder to deprioritize than one requiring a full browser + a specific website.

**GStreamer** — no longer suggested as a target. Nothing in either resolved backtrace, nor four clean EGL-call-tracer runs, implicates GStreamer's code. See [Symbolized backtraces](#symbolized-backtraces-2026-09-11).

Note that `WEBKIT_DISABLE_COMPOSITING_MODE=1` and `WEBKIT_DISABLE_DMABUF_RENDERER=1` both fail to prevent it — unsurprising in hindsight, now that neither signature involves DMA-BUF/compositing-mode-dependent code.

**Tauri** — every Linux Tauri app on this hardware inherits the crash, and it presents as "my app randomly dies on pages with video", which is hard to attribute. Two things would help, in order of value:

1. **Documentation.** This project implemented the obvious `__EGL_VENDOR_LIBRARY_FILENAMES` guard at startup, shipped it, and reverted it once benchmarked — it turns a crash into a 0.2 FPS WebView, which is harder for an app author to notice than a crash. Anyone hitting this will reach for the same guard, so recording the measured cost would save real time.
2. **An opt-in escape hatch.** The trade is genuinely worth it for a meaningful class of Tauri apps — static or low-motion UIs, kiosks, dashboards, config panels — where "no acceleration" is barely noticeable and "random segfault" is fatal. Those authors currently have to discover this whole chain themselves. Tauri controls process startup, which is the only point where these variables can still be set, so an opt-in flag (clearly documented as costing acceleration, and off by default) would put a supported option in front of exactly the people it suits.

## Getting better data

WebKit frames are unresolved above because `debuginfod.ubuntu.com` was unreachable from the test machine and no `ddebs` repo was configured. **`ddebs.ubuntu.com` itself (as opposed to the debuginfod frontend) is reachable from this machine** — confirmed 2026-08-11. A setup script is prepared at [`docs/scripts/setup-ddebs.sh`](scripts/setup-ddebs.sh) (adds the ddebs repo, installs `ubuntu-dbgsym-keyring` + `-dbgsym` packages for webkit2gtk/javascriptcoregtk/glib/gstreamer, matched to the exact installed versions). It needs `sudo`, so it's meant to be run manually rather than automatically. Writes the repo directly as a deb822 `.sources` file with the correct `Signed-By` keyring — an earlier version used the legacy one-line `.list` format and hit `apt`'s auto-migration on this system silently repointing `Signed-By` at the wrong keyring (`ubuntu-archive-keyring.gpg` instead of `ubuntu-dbgsym-keyring.gpg`), producing a `NO_PUBKEY C8CAB6595FDFF622` error even though the key was already present locally. Anyone with a debug build or `libwebkit2gtk-4.1-0-dbgsym` installed can get named frames in under a minute, since the reproduction is trivial and reliable:

```bash
ulimit -c unlimited
/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser "https://www.youtube.com/watch?v=jNQXAC9IVRw"
gdb -batch -c core.<pid> -ex "bt 40"
```

Note that cores here are large (the web process dumped ~7 GB in one run); have disk space free.

## Source-level investigation (2026-08-11)

WebKitGTK is fully open source (LGPL, [github.com/WebKit/WebKit](https://github.com/WebKit/WebKit)), but the existing backtraces in this doc are **unresolved** (raw offsets, no symbols — see [Getting better data](#getting-better-data)), so reading source without a resolved stack means guessing which function is actually implicated. A [script is prepared](#getting-better-data) to fix that; the notes below are from following the env-var trail (`WEBKIT_DMABUF_RENDERER_*`, `WEBKIT_GST_DISABLE_GL_SINK`) into the source ahead of having real symbols.

**The actual `eglCreateImageKHR`/`eglDestroyImage` calls are not in WebKit's codebase.** WebKit's video sink, [`GLVideoSinkGStreamer.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/gstreamer/GLVideoSinkGStreamer.cpp), only advertises DMA-BUF caps (`buildDMABufCaps()`) and wires together GStreamer's generic `glupload`/`glcolorconvert` elements — it does not touch EGLImages directly. The zero-copy DMA-BUF → EGLImage import itself lives one layer further down, in GStreamer's own (also open source, LGPL) GL library: [`gst-plugins-base/gst-libs/gst/gl/egl/gsteglimage.c`](https://github.com/GStreamer/gst-plugins-base/blob/master/gst-libs/gst/gl/egl/gsteglimage.c), via `gst_egl_image_from_dmabuf()` / `gst_egl_image_from_dmabuf_direct_target()`. That file — not WebKit — is the last open-source code before the call crosses into NVIDIA's closed `libnvidia-eglcore`.

**A candidate mechanism, from reading that file:** EGLImage _destruction_ is explicitly marshaled onto the GL context's owning thread via `gst_gl_context_thread_add()` (so `eglDestroyImage` is serialized). EGLImage _creation_ (`_gst_egl_image_create()`, called from `gst_egl_image_from_dmabuf*`) has **no equivalent thread confinement** — it runs on whatever thread calls it, with no synchronization visible against other EGL calls on the same context. That asymmetry — unsynchronized create, serialized-but-independent destroy — is the shape of a classic race: if WebKit's compositor thread and GStreamer's streaming thread can both touch the same EGL context around the same moment, `eglCreateImageKHR` on one thread could overlap with `eglDestroyImage` (or another `eglCreateImageKHR`) on another, which is exactly the kind of concurrent-context-use bug proprietary EGL drivers (little input validation, assume single-threaded-per-context discipline) tend to crash hard on rather than reject cleanly. This would also explain the page-specificity: a YouTube watch page continuously creates/destroys many other GL-backed layers (thumbnails, chrome, animation) sharing the same EGL context, raising the odds of an overlap that a quiet embed player or a static local `<video>` page wouldn't hit.

**This is a hypothesis, not a confirmed cause** — it is _consistent with_ crash signature 2 (a driver-internal fault 7 frames deep in `libnvidia-eglcore`, the classic result of corrupted internal state from concurrent misuse) but not proven. It also lines up with [WebKit bug 262607](https://www2.webkit.org/show_bug.cgi?id=262607) ("[GTK] Disable DMABuf renderer for NVIDIA proprietary drivers"), which proposed blanket-disabling DMA-BUF for NVIDIA and was closed **WONTFIX** in 2024 — WebKit maintainers were already aware NVIDIA + DMA-BUF is fragile in general (not video-specific) and chose not to address it broadly, which tracks with this still being unresolved.

**To actually test the race hypothesis** without needing symbolicated backtraces: an `LD_PRELOAD` shim intercepting `eglCreateImageKHR`/`eglDestroyImage`/`eglMakeCurrent`, logging thread ID + timestamp on each call during a live repro, would show directly whether calls from different threads interleave on the same context around the crash. Built at [`docs/scripts/egl-tracer/`](scripts/egl-tracer/) — `build.sh` compiles the shim, `run.sh <url>` reproduces under it (disabling WebKitGTK's process sandbox so the preload reaches `WebKitWebProcess`, where crash signature 2 actually happens), and `analyze_egl_trace.py` pairs the ENTER/EXIT log into call intervals and flags any that overlap across threads on the same EGL context. Not yet run against real NVIDIA hardware — the next step once a 580-branch machine is available.

## Additional diagnostics (2026-08-11)

- **No NVRM/Xid kernel message accompanies either crash signature.** Re-ran the MiniBrowser repro while tailing `journalctl -k`; both signatures fired in one run:

  ```text
  MiniBrowser[872924]: segfault at 48 ip 00007dbb6cfd09c2 ... in libwebkit2gtk-4.1.so.0.21.7
  WebKitWebProces[873645]: segfault at 1230 ip 00007bd9da05f05f ... in libnvidia-eglcore.so.580.173.02
  ```

  No `NVRM: Xid` line appears in the kernel log at any point around either fault. That rules out a kernel-visible GPU-level event — hung engine, MMU fault, ECC error, thermal/watchdog reset — as the trigger. The fault is a plain userspace SIGSEGV inside the closed-source EGL library itself (bad pointer/use-after-free/corrupted state), not something the GPU hardware or the `nvidia.ko` kernel module ever flags. This is consistent with a fixable userspace driver bug rather than a hardware fault, and is worth stating explicitly in any report to NVIDIA.

- **Isolated GStreamer-only reproduction: does not crash.** Ran `filesrc ! matroskademux ! vp9parse ! nvvp9dec ! glimagesink` (NVDEC VP9 decode → `GstGLUploadElement` → `glcolorconvert` → GL display, i.e. the same CUDA-decode-to-GL-texture path WebKit's video sink also exercises) against a synthetic profile-0 8-bit 4:2:0 VP9 clip — 15 back-to-back runs, fresh GL/CUDA context each time, zero crashes. This is a negative result and doesn't clear the driver — it extends the existing "not HTML5 video generally" finding one level further: even bare NVDEC-decode-into-GLMemory, repeated with fresh context setup/teardown each run, doesn't trip it outside a browser. Whatever triggers this needs something specific to WebKit's own usage (its particular EGLImage/DMA-BUF import call pattern, or the compositing complexity of a live YouTube watch page — multiple layers, dynamic resize, overlay UI) that a single-sink synthetic pipeline doesn't replicate. Caveat: the synthetic clip is a solid-color test pattern, not a real YouTube-encoded stream — a real clip (e.g. via `yt-dlp`, not installed on this machine) would be a closer match if this is revisited.

## Positive control: Intel GPU (2026-08-19)

**Update, same day — clean single-variable result.** An initial test used Konqueror (see "Earlier, weaker result" below), which turned out not to be a strict single-variable swap. Ran the actual repro instead: the exact `webkit2gtk-4.1` `MiniBrowser` binary (2.52.5) against both repro URLs from [Reproduction](#reproduction) — the DDB homepage and the YouTube watch page — on the same Intel machine (Lenovo Yoga laptop, CachyOS/Arch, Intel Iris Xe (TigerLake-LP), Mesa 26.1.6, hardware-accelerated GL confirmed via `glxinfo`).

First attempt crashed (SIGABRT, confirmed via `coredumpctl`) — but the log showed `GStreamer element autoaudiosink not found`, and the crash traced to a GLib assertion failure from a NULL signal-connect target, not the documented fault. This machine was simply missing `gst-plugins-good` (fresh CachyOS install). After installing it, both repros were re-run for the full 60s each:

- DDB homepage: 60s, clean, empty log, no crash.
- YouTube watch page (`jNQXAC9IVRw`, the faster/more reliable trigger on the NVIDIA machine — crashes there in 5–10s): 60s, clean, empty log, no crash.
- No new `coredumpctl` entries from either run.
- Visually confirmed, not just process-survival: video played correctly in both cases — no frozen frame, no black box, no dropped/frozen playback.

This is the clean version of the test: same WebKitGTK build, same binary, same exact reproduction URLs, only the GPU vendor changed (NVIDIA → Intel). It ran clean on the page that reliably segfaults NVIDIA in 5–10 seconds. Combined with the existing [bisection](#bisection) result (the only variable that prevents the crash on NVIDIA is which EGL vendor library loads) and NVIDIA's own [acknowledged internal bug](#corroboration) for the same fault class, this is strong confirmation that the crash is NVIDIA-specific rather than a general WebKitGTK/GStreamer/DDB-content defect. It is not, on its own, proof of the specific race-condition mechanism below — see [Open questions](#open-questions) for what would close that gap.

Given this, and given that KDE Plasma's WebKitGTK stack (WebKitGTK + GStreamer, same as GNOME's) is the same rendering path — not a separate one — the crash is expected to reproduce under KDE too if it reproduces under GNOME, since nothing about the fault as understood so far ([root cause assessment](#root-cause-assessment)) is GNOME-specific. That extrapolation is still untested on a KDE/NVIDIA machine.

**Updated working theory:** the [source-level investigation](#source-level-investigation-2026-08-11) already flagged the likely mechanism — GStreamer's `gsteglimage.c` serializes `eglDestroyImage` onto the owning GL thread via `gst_gl_context_thread_add()` but has no equivalent confinement for `eglCreateImageKHR`, leaving EGL-context calls from WebKit's compositor thread and GStreamer's streaming thread unsynchronized. The Intel-GPU result reinforces that this only matters on NVIDIA: a spec-compliant EGL implementation is expected to either serialize internally or reject concurrent use of a context from multiple threads cleanly, rather than corrupt state and segfault. Read that way, NVIDIA's proprietary EGL driver is the fault ultimately responsible for crashing on invalid input — but GStreamer calling `eglCreateImageKHR` without the same thread confinement it already applies to `eglDestroyImage` is what actually produces the race, and closing that asymmetry in GStreamer (thread-confining image creation the same way destruction already is) would likely prevent the crash regardless of whose fault the underlying driver behavior is. Still a hypothesis, not proven — see [Getting better data](#getting-better-data) for how to confirm it with an `LD_PRELOAD` EGL-call tracer.

**Earlier, weaker result (superseded above):** an initial test ran the DDB homepage under Konqueror on the same Intel machine and also found no crash. That result is superseded by the `MiniBrowser` test above, but is recorded for completeness: it wasn't a strict single-variable swap (GPU vendor _and_ browser changed at once), and modern Konqueror typically renders via QtWebEngine (Chromium) rather than WebKitGTK, so it likely didn't exercise the same GStreamer/EGLImage-import code path at all.

## EGL call-level tracing (2026-09-11)

The `LD_PRELOAD` tracer prepared in [Getting better data](#getting-better-data) was run against real hardware for the first time (this machine — GTX 1080, **driver 580.178.04**, a newer 580-branch point release than the 580.173.02 tested throughout the rest of this doc; the crash still reproduces on it, extending [Corroboration](#corroboration)'s point that the branch hasn't fixed this).

**First attempt: zero events, despite a confirmed crash.** `./run.sh` reproduced the documented dual-signature crash (UI process + `WebKitWebProcess`, confirmed via `journalctl -k`), but the trace log contained no `eglCreateImageKHR`/`eglDestroyImageKHR`/`eglMakeCurrent` calls at all — just one header line per process that loaded the shim (7 total). Root cause: `strings libwebkit2gtk-4.1.so.0` shows WebKitGTK's `PlatformDisplay` privately `dlopen()`s `libEGL.so.1` itself (`"Could not dlopen native EGL:"` sits next to the `"libEGL.so.1"` string) and resolves entry points via `dlsym()` against that private handle. Handle-scoped `dlsym` only searches the target library's own export table — it's a well-known LD_PRELOAD blind spot, invisible to ordinary symbol-table interposition.

**Fix: interpose `dlsym` itself** (`egl_trace.c`, using the standard `dlvsym(RTLD_NEXT, "dlsym", "GLIBC_2.2.5")` trick to obtain the real `dlsym` without infinite recursion), substituting our wrapper for `eglCreateImageKHR`/`eglDestroyImageKHR` regardless of which handle the caller resolves against.

**That fix's first version also intercepted `eglMakeCurrent` via `dlsym` and produced a severe probe effect**, not real data: ~174,000 identical `eglMakeCurrent(dpy=0x637deeccf9d0, ctx=0x637deec10d01)` `ENTER` events with **zero matching `EXIT`s**, all on one thread, spaced ~1µs apart, over <200ms — the textbook shape of self-recursion — ending in a SIGSEGV inside **`libc.so.6`**, not `libnvidia-eglcore`, i.e. a different, spurious crash. Best explanation: NVIDIA's glvnd dispatch layer re-resolves `eglMakeCurrent` internally on this driver, that internal resolution round-tripped through the same interposed `dlsym`, and got handed the shim's own wrapper back as "the real function" — so the wrapper ended up calling itself. Documented here as a methodological pitfall, not a finding about the actual bug. Fix: dropped `eglMakeCurrent` from the `dlsym` hook (it isn't needed for the create/destroy race test — `eglDestroyImageKHR`'s owning context comes from `eglGetCurrentContext`, not from snooping `eglMakeCurrent`) and added a thread-local re-entrancy guard around the two remaining wrapped functions as defense-in-depth.

**With that fixed, four clean reproductions in a row** (all `journalctl -k`-confirmed) landed at **identical fault offsets every time** — `fddbd2` in `libwebkit2gtk-4.1.so.0.21.10` (signature 1) and `a5f05f` in `libnvidia-eglcore.so.580.178.04` (signature 2) — noticeably more deterministic, at a fixed build+driver, than this doc's earlier "crash signature varies between runs" note suggested (that variability is more likely which-signature-fires-first, or differences across the driver/WebKit point releases tested over the life of this doc, than true per-run nondeterminism).

**Across all four clean runs: zero `eglCreateImageKHR`/`eglDestroyImageKHR` calls captured**, now checked via all three resolution paths a caller could plausibly use — direct linkage, `eglGetProcAddress`, and handle-scoped `dlsym`. This is a real negative result, not an instrumentation gap: `WebKitWebProcess` crashes inside `libnvidia-eglcore` without calling either tracked function beforehand in this reproduction.

**This meaningfully undercuts the gsteglimage.c race hypothesis as stated.** It's also worth noting, on rereading, that the existing [signature-2 backtrace](#what-crashes) never actually showed a GStreamer frame — only `libwebkit2gtk-4.1.so.0` frames leading directly into `libEGL_nvidia.so.0`. The `gsteglimage.c` theory was inferred from source-reading (which code _could_ create/destroy EGL images), not from a resolved stack showing GStreamer involved. Combined with this session's negative tracer result, the more likely locus now is WebKit's **own** direct EGL/GL usage — context creation, surface/swap calls, or something else in `PlatformDisplay`/the compositor — rather than GStreamer's DMA-BUF-import path specifically. **Filing against GStreamer on the strength of the source-level hypothesis alone would be premature** given this session's evidence points away from it.

The direct way to settle which EGL call actually faults is a symbolized backtrace, per [Getting better data](#getting-better-data) — not yet done on this machine (no `gdb`, no `-dbgsym` packages installed; the `setup-ddebs.sh` script is prepared but needs `sudo` and hasn't been run here). That would name the exact function in one step rather than continuing to add EGL entry points to the tracer one at a time.

## Symbolized backtraces (2026-09-11)

Following on from the [EGL call-level tracing](#egl-call-level-tracing-2026-09-11) session above, `docs/scripts/setup-ddebs.sh` was actually run (it needs an interactive `sudo` password, so this had to happen outside the agent session that prepared it). It matched debug symbols to what's now installed — **WebKitGTK has moved to 2.52.6** (`2.52.6-0ubuntu0.26.04.1`) since this doc was first written against 2.52.3, via an ordinary Ubuntu security update. The crash still reproduces, identically, on 2.52.6 — another data point against this being some narrow, since-fixed point-release regression. `gdb` (also not previously installed) came with the same package.

Reproduced under `gdb` with `ulimit -c unlimited`, capturing both processes' cores across a couple of runs (signature 2's core needed `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1` — WebKit's bubblewrap sandbox appears to disable core dumping for the sandboxed `WebKitWebProcess` as a hardening measure, same reason the [EGL tracer's `run.sh`](#egl-call-level-tracing-2026-09-11) needs it to get `LD_PRELOAD` into that process at all).

### Signature 1, resolved: null pointer, not a driver frame

```text
#0  update () at Source/WebKit/UIProcess/gtk/AcceleratedBackingStore.cpp:808
#1  enterAcceleratedCompositingMode () at Source/WebKit/UIProcess/WebPageProxy.cpp:12800
#2  enterAcceleratedCompositingMode () at Source/WebKit/UIProcess/CoordinatedGraphics/DrawingAreaProxyCoordinatedGraphics.cpp:261
...
#11 handleMessage<Messages::DrawingAreaProxy::EnterAcceleratedCompositingMode> () at Platform/IPC/HandleMessage.h:455
...
#17 dispatchIncomingMessages () at Platform/IPC/Connection.cpp:1600
```

The faulting instruction, disassembled directly from the crash frame:

```text
=> mov    0x48(%rdi),%rcx      ; rdi = 0x0 at the time of the fault
```

`rdi` is the implicit `this` for `AcceleratedBackingStore::update()`, and it's null — confirmed by the kernel's `segfault at 48` line matching the `0x48(%rdi)` offset exactly. This is a plain null-pointer dereference, not a driver fault: `update()` is being called on a backing-store object that doesn't exist (already destroyed, or never created), while the UI process is handling an `EnterAcceleratedCompositingMode` IPC message sent by the WebProcess as the video's layer enters accelerated compositing. No NVIDIA frames anywhere on this stack, consistent with the doc's original signature-1 description — now just with names attached.

### Signature 2, resolved: crash is in context teardown, not frame import

```text
#0..#7  ??? () at libnvidia-eglcore.so.580.178.04        <-- fault, unresolved (proprietary)
#8..#11 ??? () at libEGL_nvidia.so.0                      <-- unresolved (proprietary)
#12 ~GLContext () at Source/WebCore/platform/graphics/egl/GLContext.cpp:335
#13-16  (unique_ptr<GLContext>::reset(), inlined)
#17 clearGLContexts () at Source/WebCore/platform/graphics/PlatformDisplay.cpp:135
#18 stopRunLoop () at Source/WebKit/WebProcess/glib/WebProcessGLib.cpp:124
#19 terminate () at Source/WebKit/Shared/AuxiliaryProcess.cpp:242
#20 removeWebPage () at Source/WebKit/WebProcess/WebProcess.cpp:1078
#21 close () at Source/WebKit/WebProcess/WebPage/WebPage.cpp:2073
#22 stopRunLoop () at Source/WebKit/WebProcess/glib/WebProcessGLib.cpp:121
#23 operator() () at Source/WebKit/Platform/IPC/Connection.cpp:1322
...
#37 AuxiliaryProcessMain<WebKit::WebProcessMainGtk> ()
```

This is a different mechanism than every hypothesis this doc has carried so far. `GLContext.cpp:334-335`, fetched from the matching upstream tag, is:

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

**The fault is inside NVIDIA's own `eglDestroyContext()`**, called immediately after unbinding the context via `eglMakeCurrent(..., EGL_NO_CONTEXT)` — not inside `eglCreateImageKHR`/`eglDestroyImageKHR` at all, and not during frame compositing or DMA-BUF import. It happens while WebKit is **tearing down the page's GL context as part of `WebPage::close()` → `WebProcess::removeWebPage()` → `AuxiliaryProcess::terminate()`** — an ordinary, intentional process-shutdown path, not a compositing-loop operation.

### Why does the page close at all?

Neither MiniBrowser (`Tools/MiniBrowser/gtk/main.c` — checked, no auto-quit/timeout logic) nor this reproduction closes the page or the browser window. Nothing external sends `SIGTERM` before the crash either — the process exits via `SIGSEGV` (exit 139) well inside the documented 5-10s window, not via `timeout`'s deadline.

**Working theory, not yet directly proven:** signature 1 happens first. The UI process (`MiniBrowser`) crashes on the null-pointer bug in `AcceleratedBackingStore::update()`, which kills its IPC connection to `WebKitWebProcess`. `AuxiliaryProcess::terminate()`'s own body — `protectedParentProcessConnection()->invalidate(); stopRunLoop();` — is exactly the shape of a reaction to a severed parent connection: the WebProcess notices its parent is gone and starts an ordinary graceful self-shutdown (close all pages, tear down GL). It's *that* teardown — reached via completely normal, well-trodden code, not some rare error-recovery branch — that crashes a second time inside NVIDIA's `eglDestroyContext()`.

If this theory holds, it reframes the whole bug: the interesting question stops being "why does GStreamer/WebKit's video-frame-import path crash on NVIDIA" (no evidence supports that anymore) and becomes **two separate, both fairly ordinary-looking defects that happen to fire back-to-back**:

1. A **WebKitGTK bug**: `AcceleratedBackingStore::update()` is reachable with a null backing store while handling `EnterAcceleratedCompositingMode`, on some page/timing condition that a YouTube watch page hits and the embed player doesn't. This crash has no NVIDIA involvement at all — it would presumably reproduce on any GPU, if the same timing condition is hit. (Untested here — everything in this doc so far has only run on NVIDIA, precisely because that's where signature 2 masked the search for other causes.)
2. An **NVIDIA driver bug**: `eglDestroyContext()`, called right after `eglMakeCurrent(..., EGL_NO_CONTEXT)` on the exact same context, segfaults inside `libnvidia-eglcore`. This is an entirely ordinary context-teardown sequence — nothing exotic about WebKit's usage here — so if it reproduces standalone (see [Open questions](#open-questions)), it's a plain NVIDIA driver bug independent of what led up to it.

**This session's evidence does not support filing against GStreamer.** No GStreamer frame appears on either resolved stack, and the earlier [EGL call-level tracing](#egl-call-level-tracing-2026-09-11) found zero `eglCreateImageKHR`/`eglDestroyImageKHR` calls in four clean reproductions. The `gsteglimage.c` thread-confinement hypothesis is superseded by the findings in this section.

Draft issue writeups for both signatures — ready for review before filing — are at [`docs/issue-drafts/webkitgtk-null-pointer-backing-store.md`](issue-drafts/webkitgtk-null-pointer-backing-store.md) and [`docs/issue-drafts/nvidia-egldestroycontext-segfault.md`](issue-drafts/nvidia-egldestroycontext-segfault.md).

## Open questions

- ~~The exact GL/EGL call that faults — unidentified.~~ — **resolved 2026-09-11**: signature 2 is `eglDestroyContext()`, signature 1 is a null-pointer `this` in `AcceleratedBackingStore::update()`, no EGL call involved. See [Symbolized backtraces](#symbolized-backtraces-2026-09-11).
- ~~Whether GStreamer's `_gst_egl_image_create()`... — the thread-safety hypothesis~~ — **superseded 2026-09-11**: four clean tracer runs found zero `eglCreateImageKHR`/`eglDestroyImageKHR` calls, and neither resolved backtrace has a GStreamer frame. GStreamer is not implicated by anything found so far.
- **New, the key open question as of 2026-09-11:** why is `AcceleratedBackingStore::update()` reachable with a null backing store while handling `EnterAcceleratedCompositingMode`? This looks like it may be a plain WebKitGTK lifecycle bug, independent of NVIDIA — reading `WebPageProxy.cpp` around line 12800 and `DrawingAreaProxyCoordinatedGraphics.cpp` around line 230-261 (both named in the [resolved signature-1 backtrace](#signature-1-resolved-null-pointer-not-a-driver-frame)) would show what's supposed to guarantee the backing store exists before this message is dispatched, and where that guarantee breaks down for a YouTube watch page specifically.
- **Whether signature 1 reproduces on Intel GPU too.** [Positive control](#positive-control-intel-gpu-2026-08-19) only confirmed the *combined* dual-signature crash doesn't happen on Intel — it didn't isolate signature 1 alone. If the null-pointer bug is a genuine WebKit lifecycle race independent of the GPU vendor, an Intel machine simply never gets far enough to hit it before rendering succeeds normally. Deliberately trying to trigger just the `EnterAcceleratedCompositingMode`/backing-store race on Intel (e.g. by adding artificial delay/load around page load) would help separate "WebKit bug, masked by timing on Intel" from "only reachable via the NVIDIA-specific failure chain."
- **Whether `eglDestroyContext()` crashes in isolation**, outside WebKit entirely — a minimal repro (`eglCreateContext` + immediately `eglMakeCurrent(..., EGL_NO_CONTEXT)` + `eglDestroyContext`, no rendering, no video) would tell us whether this is a general NVIDIA context-teardown bug (making it trivial to report to NVIDIA directly, and likely a duplicate of [bug 5701801](#corroboration)) or specific to some state WebKit's GL context is in when it gets torn down here.
- The specific page condition on a YouTube watch page that triggers it, given the embed player playing the same video does not — still unidentified, and now more precisely "triggers the `AcceleratedBackingStore::update()` null-pointer bug" rather than a generic "video plays" condition.
- Whether NVIDIA `580.142` (in Ubuntu's `resolute/restricted`) predates the regression — untested.
- Whether **`550.144.03`** (off the 580 branch, [confirmed to fix a related WebKitGTK crash for another user](#corroboration)) avoids this crash too — untested, and now the more promising of the two driver-downgrade avenues; see [Mitigations evaluated](#mitigations-evaluated).
- Whether the zink `Failed to create EGL image from DMABuf` failure (under the [zink mitigation](#mitigations-evaluated)) shares a root with either signature — no longer an obvious connection now that neither signature involves EGLImage creation; may simply be an unrelated zink limitation.
- Why Mesa EGL cannot create a DRI2 screen on this device even with `LIBGL_ALWAYS_SOFTWARE=1` — a working software fallback would at least give affected users a slow-but-usable escape hatch.
- ~~Whether WebKitGTK specifically (not just "some Linux browser") is crash-free on Intel GPU~~ — **resolved 2026-08-19**: the exact `MiniBrowser`/`webkit2gtk-4.1` repro from [Reproduction](#reproduction) ran clean, full 60s, on both trigger URLs on Intel GPU — see [Positive control](#positive-control-intel-gpu-2026-08-19).
- Whether the crash reproduces on KDE/NVIDIA — expected to, since KDE uses the same WebKitGTK + GStreamer stack as GNOME, but untested.

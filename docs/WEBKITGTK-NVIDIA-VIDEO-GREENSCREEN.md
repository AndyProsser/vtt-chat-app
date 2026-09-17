# WebKitGTK video plays green instead of frame content, on NVIDIA, after the 321683 sandbox-crash patch

**Status:** Video decode fix confirmed live on GTK4/Epiphany. The `/dev/nvidia-uvm` sandbox patch (defect #1) restores hardware decode inside the real sandboxed WebProcess — confirmed 2026-09-16 in Epiphany against the system-installed patched library: DDB video plays picture correctly (no green), and `GST_DEBUG=GST_ELEMENT_FACTORY:4` shows `nvh264dec` instantiated for all 4 videos tested, with no `avdec_h264` fallback. Defect #2 (the `avdec_h264`/`glupload` I420 bug) is sidestepped in practice since hardware decode now handles DDB's H.264 content, but remains a real GStreamer bug worth filing on its own merits. Two upstream reports drafted, ready to file — see [Filing](#filing).

**Still not usable end-to-end on GTK3 (this project's actual dependency)**: testing the real Tauri app (`webkit2gtk-4.1`) against the real DDB homepage on 2026-09-17 found and fixed two real WebKitGTK bugs blocking it (a stale build that silently dropped the 321683 fix, and a second unpatched null-guard gap in the paint/draw path) — see [`WEBKITGTK-NVIDIA-EGL-CRASH.md`'s 2026-09-17 updates](WEBKITGTK-NVIDIA-EGL-CRASH.md#root-cause-found-a-stale-build-plus-a-second-unpatched-null-guard-gap-2026-09-17) for the full writeup. With both fixed, the crash is gone, but the homepage now renders **blank** instead — confirmed *not* a video-decode or DMA-BUF-frame issue (forcing software decode made no difference; non-video DOM content is blank too) — see that doc's [remaining open issue section](WEBKITGTK-NVIDIA-EGL-CRASH.md#remaining-open-issue-gtk3-homepage-renders-blank-once-it-enters-accelerated-compositing-2026-09-17-unresolved). This app's homepage-redirect workaround stays in place until that's resolved.

**Reporter context:** found immediately after validating the [321683 sandbox null-pointer patch](WEBKITGTK-NVIDIA-EGL-CRASH.md#patch-validated-locally-2026-09-11) under Epiphany — the crash is gone, but DDB's homepage background video (and any local `<video>` tested) now plays audio only, rendering as a solid dark-green frame instead of picture.

**Investigated:** 2026-09-14

## Summary

Two independent, stacked defects:

1. **WebKitGTK's bubblewrap sandbox is missing the NVIDIA device nodes CUDA context creation needs.** [`BubblewrapLauncher.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Launcher/glib/BubblewrapLauncher.cpp)'s `bindOpenGL()` allowlists `/dev/nvidiactl`, `/dev/nvidia0`, and the legacy `/dev/nvidia`, but not `/dev/nvidia-uvm` or `/dev/nvidia-modeset`. `strace` on a working (unsandboxed) hardware-decode pipeline shows both are opened. Without them, `nvh264dec`'s CUDA context — and the CUDA/GL interop it uses to hand WebKit a zero-copy `GLMemory` frame — fails to initialize inside the sandboxed WebProcess.
2. **GStreamer's software-decode fallback then hits a real `glupload`/`glcolorconvert` bug.** When hardware decode isn't available, `decodebin` falls back to `avdec_h264`, which outputs planar I420 (3 separate Y/U/V planes) rather than NVDEC's semi-planar NV12. Feeding I420 through `glupload ! glcolorconvert` — the same element chain WebKit's own `webkitglvideosink` uses — produces a solid, uniform dark-green frame on this GStreamer 1.28.2 / EGL / Wayland / NVIDIA stack. Converting to NV12 in software before `glupload` avoids it entirely; the bug is specific to the I420-upload path.

Neither defect alone explains the symptom: fix only #1 and a machine that ever legitimately falls back to software decode (unsupported profile, no GPU, etc.) still hits #2. Fix only #2 and hardware decode — which renders correctly on its own — never even reaches the broken path, so the sandbox device gap would stay latent until the next thing that forces a software-decode fallback.

## Environment

Same machine as the crash investigation: Ubuntu 26.04 LTS, kernel 7.0.0-31-generic, NVIDIA GeForce GTX 1080, driver 580.178.04, GStreamer 1.28.2, WebKitGTK 2.52.6 patched with the 321683 fix (see the other doc). `nvcodec` plugin present and ranked `primary + 1 (257)` — `nvh264dec` is `decodebin`'s preferred H.264 decoder whenever it's usable.

## Evidence

### 1. Reproduced the exact symptom outside WebKit, with WebKit's own real content

Downloaded the actual DDB homepage clip and ran it through two pipelines using the identical `glupload ! glcolorconvert` chain WebKit's `webkitglvideosink` uses (confirmed via `GST_DEBUG=GST_ELEMENT_FACTORY:4` against the sandboxed MiniBrowser itself — it instantiates `webkitglvideosink → glupload → glcolorconvert` in that order):

```bash
# Hardware decode (what decodebin picks by default) — renders correctly
gst-launch-1.0 -e filesrc location=real.mp4 ! qtdemux ! h264parse ! nvh264dec ! \
  glupload ! glcolorconvert ! gldownload ! videoconvert ! pngenc ! multifilesink location=real_hw_%02d.png

# Software decode — solid dark-green frame, pixel-identical in hue to the bug screenshot
gst-launch-1.0 -e filesrc location=real.mp4 ! qtdemux ! h264parse ! avdec_h264 ! \
  glupload ! glcolorconvert ! gldownload ! videoconvert ! pngenc ! multifilesink location=real_sw_%02d.png
```

`real_hw_*.png` shows the actual D&D Beyond map artwork. `real_sw_*.png` is a uniform dark green (`#004000`-ish), matching the reported screenshot exactly.

### 2. The single variable is I420 vs. NV12, not hardware vs. software decode

```bash
# avdec_h264's native I420 output, forced to NV12 in software before glupload — fixes it
gst-launch-1.0 -e filesrc location=testbars.mp4 ! qtdemux ! h264parse ! avdec_h264 ! \
  videoconvert ! video/x-raw,format=NV12 ! glupload ! glcolorconvert ! gldownload ! videoconvert ! pngenc ! ...
```

This renders correctly (SMPTE bars, not green) — same decoder, same GL chain, only the pixel format feeding `glupload` changed. `avdec_h264`'s native output is confirmed I420 via `fakesink -v` caps negotiation.

### 3. `nvh264dec`'s CUDA context needs devices the sandbox doesn't grant

```bash
strace -f -e trace=openat gst-launch-1.0 -e filesrc location=real.mp4 ! qtdemux ! h264parse ! \
  nvh264dec ! glupload ! glcolorconvert ! gldownload ! fakesink
```

Opens `/dev/nvidia0`, `/dev/nvidiactl`, `/dev/nvidia-modeset`, and `/dev/nvidia-uvm`. Cross-referencing `BubblewrapLauncher.cpp`'s `bindOpenGL()`:

```cpp
// Nvidia
"--dev-bind-try", "/dev/nvidiactl", "/dev/nvidiactl",
"--dev-bind-try", "/dev/nvidia0", "/dev/nvidia0",
"--dev-bind-try", "/dev/nvidia", "/dev/nvidia",
```

`/dev/nvidia-uvm` and `/dev/nvidia-modeset` are absent. `--dev-bind-try` is a no-op when the source path doesn't exist, so adding them is safe on non-NVIDIA systems.

### 4. Live end-to-end confirmation (sandboxed vs. `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1`) — inconclusive, not pursued further

Attempted to confirm directly in the patched `MiniBrowser`, both with and without the sandbox disabled, both before and after rebuilding with the `/dev/nvidia-uvm` patch below. Every run hit an unrelated `Gdk-Message: Error 71 (Protocol error) dispatching to Wayland display` and exited (code 0-1, no coredump) within ~100ms of loading the page — a `MiniBrowser`/GDK/Wayland issue specific to launching it from this automated shell environment, not the bug under investigation (the real behavior — video plays with audio, just green — was reported from an interactive Epiphany session, which doesn't hit this). The closest run (post-rebuild, under `strace`) got as far as `PulseAudio` client setup — i.e. still setting up the *audio* sink — before dying, confirming it never reached video decoder autoplugging at all; `/dev/nvidia-uvm` was correspondingly never opened by that run, which is expected given it never got that far, not evidence against the fix.

**Net effect: the patch is verified statically (matches exactly the devices `strace` showed `nvh264dec` needs) and the rebuild succeeded cleanly, but live confirmation that it restores hardware decode inside the real sandboxed process still needs to happen interactively** — via `scripts/dev-with-patched-webkitgtk.sh` against the real DDB page, or `MiniBrowser` launched from an actual desktop session rather than this shell. That's the same category of test the original 321683 patch needed (see [Patch validated locally](WEBKITGTK-NVIDIA-EGL-CRASH.md#patch-validated-locally-2026-09-11) in the sibling doc) — it was also run interactively there, not from an automated tool.

## Fix

Patched locally: `docs/patches/webkitgtk-sandbox-missing-nvidia-uvm.patch`, adding `/dev/nvidia-uvm`, `/dev/nvidia-uvm-tools`, and `/dev/nvidia-modeset` to `bindOpenGL()` alongside the existing NVIDIA entries. Applied to the same build tree as the 321683 patch (`~/Development/webkitgtk-321683-build/WebKit`, on top of 321683 — both patches are in that tree now) and rebuilt via `./Tools/Scripts/build-webkit --gtk --release --no-experimental-features --cmakeargs="-DUSE_GTK4=OFF -DUSE_LIBRICE=OFF"` inside the `wkdev` container — a fast incremental relink (40s, only this one file changed) rather than a full rebuild.

**Next step (not yet done): live confirmation.** Run `scripts/dev-with-patched-webkitgtk.sh` (or `Tools/Scripts/run-minibrowser --release --gtk` against the DDB homepage) from an interactive desktop session and confirm the video renders correctly instead of green. See [Evidence #4](#4-live-end-to-end-confirmation-sandboxed-vs-webkit_disable_sandbox_this_is_dangerous1--inconclusive-not-pursued-further) for why this couldn't be completed from this automated session.

This only addresses defect #1. Defect #2 (the `glupload`/`glcolorconvert` I420 bug) is a real GStreamer/graphics-stack issue independent of the sandbox — worth reporting on its own merits even though fixing #1 means this app's real-world traffic (H.264 baseline/main/high, all NVDEC-supported) should never reach it in practice.

## Filing

Draft reports, not yet submitted (matches this project's existing practice of drafting locally first — see the sibling crash doc):

- [`docs/issue-drafts/webkitgtk-sandbox-missing-nvidia-uvm.md`](issue-drafts/webkitgtk-sandbox-missing-nvidia-uvm.md) — WebKitGTK, `BubblewrapLauncher.cpp` device allowlist.
- [`docs/issue-drafts/gstreamer-glupload-i420-green-screen.md`](issue-drafts/gstreamer-glupload-i420-green-screen.md) — GStreamer, `glupload`/`glcolorconvert` I420 path.

## Update 2026-09-14: a third, unrelated bug blocked live confirmation — now unblocked

While attempting the live confirmation above, the actual `npm run dev` / Tauri app crashed on startup with `Gdk-Message: Error 71 (Protocol error) dispatching to Wayland display` — the exact same signature this doc's [Evidence #4](#4-live-end-to-end-confirmation-sandboxed-vs-webkit_disable_sandbox_this_is_dangerous1--inconclusive-not-pursued-further) had dismissed as a shell/tool-specific `MiniBrowser` artifact. That dismissal was wrong. With `WAYLAND_DEBUG=1`, the actual protocol error is:

```text
wl_display#1.error(wp_linux_drm_syncobj_surface_v1#55, 2, "Explicit Sync only supported on dmabuf buffers")
```

Mutter fatally errors the whole Wayland connection when the patched WebKitGTK build's window surface has a `wp_linux_drm_syncobj_surface_v1` (explicit-sync) object set up, but then attaches a non-DMA-BUF `wl_buffer`. This kills the client outright — it's why the app exits instead of just rendering wrong.

**Isolated as a pre-existing issue, unrelated to either patch in this doc:**

- Reproduces identically with the `/dev/nvidia-uvm` sandbox patch reverted (`git stash` in the WebKit tree, rebuild, retest) — same crash, same error.
- Reproduces in a completely bare `MiniBrowser "about:blank"` — no video, no Tauri, no app code.
- Reproduces via the **system-installed** patched library too (`/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser`, no `LD_LIBRARY_PATH`/`WEBKIT_EXEC_PATH` override at all) — ruling out the dev script's override mechanism as the cause.

**Unresolved:** why the very first report in this investigation (Epiphany, system-installed patched library, playing the actual DDB video) reportedly did *not* hit this — it got as far as a rendered-but-green frame, further than any test in this session managed. Whether something in the environment changed between that test and this session (package update, session restart) or the crash is timing/non-deterministic is not established. Worth asking whoever reproduces this next to also try Epiphany fresh, for comparison.

**Confirmed workaround: `WEBKIT_DISABLE_DMABUF_RENDERER=1`.** With it set, the app survived the full run (no crash), and — combined with the `/dev/nvidia-uvm` sandbox patch — `nvh264dec` was instantiated with no fallback and no errors, decoding the real DDB video via hardware inside the sandbox:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./scripts/dev-with-patched-webkitgtk.sh
```

This wasn't confirmed against the original NVIDIA crash this doc's sibling doc investigates (that doc's own bisection table found `WEBKIT_DISABLE_DMABUF_RENDERER=1` did *not* prevent that crash on its own) — but for this explicit-sync issue specifically, it's a clean fix: it stops WebKit from negotiating the DMA-BUF/explicit-sync surface path that Mutter is rejecting. Not yet added to `dev-with-patched-webkitgtk.sh` itself — that's a judgment call (disabling DMA-BUF rendering has its own performance trade-offs, per the sibling doc's "Mitigations evaluated" section) left for whoever picks this up next to decide, informed by an actual visual check that video still renders correctly (not just that the decoder instantiates) under this combination.

## Update 2026-09-14: retested Epiphany directly — confirms the story, refines defect #2

Asked for a fresh comparison: **Epiphany still works** (no explicit-sync crash — that crash is specific to `MiniBrowser`/Tauri, not this build in general), **DDB still shows the green screen**, but **YouTube plays correctly**. Investigated why YouTube — also software-decoded, since the system install doesn't have the `/dev/nvidia-uvm` patch yet — doesn't hit the same bug DDB does.

Traced Epiphany's actual GStreamer pipeline for both (`GST_DEBUG=GST_ELEMENT_FACTORY:4`, system-installed patched library, no overrides):

- DDB (H.264): `avdec_h264` — software, confirming the sandbox device gap (defect #1) is real and still present in the system install.
- YouTube (VP9): `vp9dec` — also software. **Not hardware decode either** — so YouTube's success isn't "the sandbox gap doesn't affect it."

So both are software-decoded, yet only one shows green. This forced a correction to [defect #2](#summary): it is **not** "I420 breaks `glupload`/`glcolorconvert`" as originally stated. Re-tested directly: `vp9dec`'s native I420 output renders correctly through the identical `glupload ! glcolorconvert` chain `avdec_h264`'s I420 output turns green through. Tried forcing `avdec_h264`'s output to match `vp9dec`'s caps exactly (`chroma-site`, `multiview-mode`) — neither fixed it; a bare `videoconvert` passthrough with no format change didn't either. Only an actual re-encode to NV12 fixes it. So the real bug is specific to `avdec_h264`'s buffers in some way not visible in caps — see the corrected [GStreamer issue draft](issue-drafts/gstreamer-glupload-i420-green-screen.md) for the full bisection.

**This doesn't change the recommended fix.** The `/dev/nvidia-uvm` sandbox patch remains the right primary fix: once hardware decode works, DDB's H.264 content decodes via `nvh264dec` (NV12, zero-copy `GLMemory`) and never reaches `avdec_h264` at all, sidestepping whatever `avdec_h264`'s bug actually is rather than needing to fully solve it.

## Update 2026-09-16: live confirmation — hardware decode restored, video renders correctly

Retested in Epiphany (system-installed patched library, no overrides) against DDB's actual video content. Result: video plays correctly, no green frame, across all 4 videos tested. `GST_DEBUG=GST_ELEMENT_FACTORY:4` confirms `nvh264dec` (hardware) is instantiated each time, with no `avdec_h264` fallback — closing the last open item from [Evidence #4](#4-live-end-to-end-confirmation-sandboxed-vs-webkit_disable_sandbox_this_is_dangerous1--inconclusive-not-pursued-further) and the Fix section's "next step." The `/dev/nvidia-uvm` sandbox patch is the confirmed fix for this app's real-world traffic; defect #2 remains real but is no longer on the path DDB's content takes.

Both draft reports in [Filing](#filing) are ready to submit as-is.

## Open questions

- Whether `/dev/nvidia-uvm-tools` is actually required (added alongside `/dev/nvidia-uvm` defensively — the CUDA docs describe it as used for profiling/tools, not core context creation — but untested whether omitting it still works).
- The exact mechanism inside `glcolorconvert`'s I420 shader path that produces green specifically (not just wrong colors) — not investigated at the GLSL/shader level, only bisected behaviorally. Root cause deep enough for this project's purposes (identified the fix), but a GStreamer maintainer will likely want the shader-level explanation.
- Whether this I420 upload bug is specific to this GStreamer 1.28.2 build, or reproduces on other versions/distros — untested elsewhere.
- The `MiniBrowser` `Error 71` Wayland protocol exit from [Evidence #4](#4-live-end-to-end-confirmation-sandboxed-vs-webkit_disable_sandbox_this_is_dangerous1--inconclusive-not-pursued-further) — unexplained, and blocks fully automated end-to-end testing of future patches in this environment.

# Draft: glupload/glcolorconvert renders solid green for avdec_h264's I420 output specifically (EGL/Wayland/NVIDIA)

**Target:** https://gitlab.freedesktop.org/gstreamer/gstreamer — component `gst-plugins-base` (`gst-libs/gst/gl`) or `gst-plugins-ugly`/ffmpeg integration (`avdec_h264`) — see [Not yet investigated](#not-yet-investigated) for why the exact component is still unclear.
**Status:** draft, not yet filed. Investigation at `vtt-chat-app/docs/WEBKITGTK-NVIDIA-VIDEO-GREENSCREEN.md`.

---

## Summary

Feeding `avdec_h264`'s decoded I420 (3-plane Y/U/V) output into `glupload ! glcolorconvert` produces a solid, uniform dark-green frame instead of the decoded picture. **This is narrower than it first looked**: it is not "I420 upload is broken in general" — `vp9dec`'s native I420 output goes through the identical `glupload ! glcolorconvert` chain and renders correctly. Converting `avdec_h264`'s output to NV12 before `glupload` also fixes it. So something about `avdec_h264`'s specific I420 buffers (not the I420 *format* itself, and not any caps field tested so far — see [What this rules out](#what-this-rules-out)) trips the bug.

Found via WebKitGTK (`webkitglvideosink` uses this exact `glupload ! glcolorconvert` chain for its video sink), but reproduces with plain `gst-launch-1.0`, no WebKit involved.

## Environment

- GStreamer 1.28.2 (`gst-plugins-base`, `gst-plugins-bad`, Ubuntu 26.04 packaging)
- Ubuntu 26.04 LTS, kernel 7.0.0-31-generic
- NVIDIA GeForce GTX 1080, proprietary driver 580.178.04, Wayland session (`GstGLDisplayWayland`)
- Not yet tested on other GPU vendors or non-Wayland display backends — see [Open questions](#open-questions).

## Reproduction

```bash
# Synthetic ground truth (SMPTE color bars), H.264 baseline
gst-launch-1.0 -e videotestsrc pattern=smpte num-buffers=60 ! \
  video/x-raw,width=640,height=360,framerate=30/1 ! x264enc ! video/x-h264,profile=baseline ! \
  h264parse ! mp4mux ! filesink location=testbars.mp4

# BROKEN: software decode (I420) -> glupload -> glcolorconvert -> solid green
gst-launch-1.0 -e filesrc location=testbars.mp4 ! qtdemux ! h264parse ! avdec_h264 ! \
  glupload ! glcolorconvert ! gldownload ! videoconvert ! pngenc ! \
  multifilesink location=frame_sw_%02d.png

# WORKS: hardware decode (NV12, native GLMemory via CUDA/GL interop) -> renders correctly
gst-launch-1.0 -e filesrc location=testbars.mp4 ! qtdemux ! h264parse ! nvh264dec ! \
  glupload ! glcolorconvert ! gldownload ! videoconvert ! pngenc ! \
  multifilesink location=frame_hw_%02d.png

# ISOLATES THE VARIABLE: same software decoder, forced to NV12 before glupload -> renders correctly
gst-launch-1.0 -e filesrc location=testbars.mp4 ! qtdemux ! h264parse ! avdec_h264 ! \
  videoconvert ! video/x-raw,format=NV12 ! glupload ! glcolorconvert ! gldownload ! \
  videoconvert ! pngenc ! multifilesink location=frame_swnv12_%02d.png

# COUNTER-EVIDENCE: a DIFFERENT decoder's native I420 output (same caps format) -> renders correctly
gst-launch-1.0 -e videotestsrc pattern=smpte num-buffers=30 ! \
  video/x-raw,format=I420,width=640,height=360,framerate=30/1 ! vp9enc ! webmmux ! filesink location=vp9bars.webm
gst-launch-1.0 -e filesrc location=vp9bars.webm ! matroskademux ! vp9dec ! \
  glupload ! glcolorconvert ! gldownload ! videoconvert ! pngenc ! multifilesink location=frame_vp9_%02d.png
```

`avdec_h264`'s native output caps, confirmed via `fakesink -v`:

```
video/x-raw, format=(string)I420, width=(int)640, height=(int)360, interlace-mode=(string)progressive,
pixel-aspect-ratio=(fraction)1/1, chroma-site=(string)jpeg, colorimetry=(string)bt601, framerate=(fraction)30/1
```

`frame_sw_*.png`: solid `#004000`-ish green, every pixel. `frame_hw_*.png` and `frame_swnv12_*.png`: correct SMPTE bars. Also reproduced with real H.264 (constrained baseline, 1280x720, bt709) content, not just the synthetic clip — same result, green matches this exact hue in both cases, suggesting it's not colorimetry-metadata-dependent (bt601 vs bt709 input both produce the same green, not two different wrong colors).

## What this rules out

- Not decoder-family-specific in the "hardware vs. software" sense: `vp9dec` is also pure software (libvpx) and is fine. The split is specifically `avdec_h264` (libav/ffmpeg-backed) vs. everything else tried.
- Not colorimetry-tag-dependent: reproduces with both a bt601-tagged synthetic clip and a bt709-tagged real clip, same output color.
- Not resolution- or content-dependent: reproduces on a 640x360 synthetic color-bar clip and a 1280x720 real photographic/illustrated clip alike.
- **Not actually I420-vs-NV12 as a format, despite first appearances**: `vp9dec`'s native I420 output (same `format=(string)I420` caps) renders correctly through the identical `glupload ! glcolorconvert` chain. Confirmed twice, with fresh output files each time, to rule out a fluke.
- Not the `chroma-site` caps field: `avdec_h264` tags `chroma-site=jpeg`, `vp9dec` omits the field entirely (defaults to mpeg2 siting). Forcing `avdec_h264`'s output to `chroma-site=mpeg2` via `videoconvert` before `glupload` — matching `vp9dec`'s siting — **did not** fix the green screen.
- Not the `multiview-mode`/`multiview-flags` caps fields: `vp9dec` sets `multiview-mode=mono` (+ flags), `avdec_h264` omits both. Forcing `avdec_h264`'s output to `multiview-mode=mono` **did not** fix it either.
- Not fixed by buffer normalization alone: piping `avdec_h264`'s output through a plain `videoconvert` with *no* caps changes at all (I420 in, I420 out) still produces the green screen — ruling out "it's really about `avdec_h264`'s buffer pool/stride, and any copy through `videoconvert` fixes it regardless of format."
- **Is fixed by an actual format conversion to NV12** — the one intervention that reliably works, from either decoder's I420 output.

So the working theory is narrower than "any I420 breaks it": something specific to the *pixel content or buffer layout* `avdec_h264` produces — not visible in caps, not fixed by any caps field forced to match `vp9dec` — differs from `vp9dec`'s I420 output in a way that only an actual NV12 re-encode papers over. That's as far as black-box behavioral testing can narrow it.

## Not yet investigated

This was bisected entirely behaviorally (which decoder/input triggers it, which caps fields don't explain it), not traced at the `glupload`/`glcolorconvert` shader/texture level or by inspecting the actual buffer bytes `avdec_h264` vs. `vp9dec` hand to `glupload` (plane strides/offsets, whether `GstVideoMeta` is present/absent or differs between the two, actual pixel values in the U/V planes). That inspection is the natural next step and would likely resolve this faster than further black-box bisection — worth doing before filing, or handing to a GStreamer maintainer who can point a debugger at `gst_gl_memory_copy_into` / `_gst_gl_upload_scale_get_shader` for the I420 case with real vs. suspect buffers side by side.

## Open questions

- The actual mechanism — see [Not yet investigated](#not-yet-investigated). This is now the central open question; everything else is secondary until this is answered.
- Whether this reproduces on non-NVIDIA GPUs, or is specific to this driver/EGL combination (the crash investigation this was found alongside, in `WEBKITGTK-NVIDIA-EGL-CRASH.md`, found several NVIDIA-specific EGL issues on this same machine — worth checking whether this is a fourth, or actually vendor-agnostic).
- Whether X11 (`GDK_BACKEND=x11` / non-Wayland `GstGLDisplay`) avoids it — only tested under `GstGLDisplayWayland` so far.
- Whether other GStreamer versions (this is 1.28.2, fairly new) reproduce it, or it's a recent regression.
- Whether other libav-backed decoders (`avdec_h265`, `avdec_mpeg2video`, etc.) share whatever `avdec_h264` is doing differently from `vp9dec`, which would point at the shared libav/ffmpeg integration layer rather than something H.264-specific.

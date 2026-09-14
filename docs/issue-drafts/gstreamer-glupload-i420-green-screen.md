# Draft: glupload/glcolorconvert renders solid green for system-memory I420 input (EGL/Wayland/NVIDIA)

**Target:** https://gitlab.freedesktop.org/gstreamer/gstreamer — component `gst-plugins-base` (`gst-libs/gst/gl`)
**Status:** draft, not yet filed. Investigation at `vtt-chat-app/docs/WEBKITGTK-NVIDIA-VIDEO-GREENSCREEN.md`.

---

## Summary

Uploading a planar I420 (3-plane Y/U/V) `video/x-raw` buffer via `glupload ! glcolorconvert` produces a solid, uniform dark-green output frame instead of the decoded picture. The identical pipeline with NV12 (2-plane semi-planar) input renders correctly. Only the plane layout differs — same decoded content, same GL context/display, same driver.

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
```

`avdec_h264`'s native output caps, confirmed via `fakesink -v`:

```
video/x-raw, format=(string)I420, width=(int)640, height=(int)360, interlace-mode=(string)progressive,
pixel-aspect-ratio=(fraction)1/1, chroma-site=(string)jpeg, colorimetry=(string)bt601, framerate=(fraction)30/1
```

`frame_sw_*.png`: solid `#004000`-ish green, every pixel. `frame_hw_*.png` and `frame_swnv12_*.png`: correct SMPTE bars. Also reproduced with real H.264 (constrained baseline, 1280x720, bt709) content, not just the synthetic clip — same result, green matches this exact hue in both cases, suggesting it's not colorimetry-metadata-dependent (bt601 vs bt709 input both produce the same green, not two different wrong colors).

## What this rules out

- Not decoder-specific: reproduces with `avdec_h264` (pure software, libavcodec) — no hardware/vendor decoder involved on the broken path at all.
- Not colorimetry-tag-dependent: reproduces with both a bt601-tagged synthetic clip and a bt709-tagged real clip, same output color.
- Not resolution- or content-dependent: reproduces on a 640x360 synthetic color-bar clip and a 1280x720 real photographic/illustrated clip alike.
- Is plane-layout-dependent: the only variable that flips the result is I420 (3-plane) vs. NV12 (2-plane semi-planar) immediately before `glupload`, decoder and everything downstream held constant.

## Not yet investigated

This was bisected behaviorally (which input format triggers it), not traced at the `glupload`/`glcolorconvert` shader/texture level — don't have a specific GLSL fragment or texture-format (e.g. `GL_LUMINANCE_ALPHA` vs `GL_RG` chroma-plane sampling) implicated yet. A maintainer familiar with `gst-libs/gst/gl/gstglcolorconvert.c`'s YUV shader selection will likely get there faster than continuing to bisect from the outside.

## Open questions

- Whether this reproduces on non-NVIDIA GPUs, or is specific to this driver/EGL combination (the crash investigation this was found alongside, in `WEBKITGTK-NVIDIA-EGL-CRASH.md`, found several NVIDIA-specific EGL issues on this same machine — worth checking whether this is a fourth, or actually vendor-agnostic).
- Whether X11 (`GDK_BACKEND=x11` / non-Wayland `GstGLDisplay`) avoids it — only tested under `GstGLDisplayWayland` so far.
- Whether other GStreamer versions (this is 1.28.2, fairly new) reproduce it, or it's a recent regression.
- The actual broken code path inside `glcolorconvert`'s I420-to-RGB conversion — see [Not yet investigated](#not-yet-investigated).

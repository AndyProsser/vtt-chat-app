# Draft: [GTK] Bubblewrap sandbox missing /dev/nvidia-uvm and /dev/nvidia-modeset breaks NVDEC hardware video decode

**Target:** https://bugs.webkit.org/ — Component: `WebKitGTK`
**Status:** draft, ready to file — fix confirmed live 2026-09-16 (see below). Investigation at `vtt-chat-app/docs/WEBKITGTK-NVIDIA-VIDEO-GREENSCREEN.md`.

---

## Summary

`BubblewrapLauncher.cpp`'s `bindOpenGL()` bind-mounts `/dev/nvidiactl`, `/dev/nvidia0`, and the legacy `/dev/nvidia` into the sandboxed WebProcess, but not `/dev/nvidia-uvm` or `/dev/nvidia-modeset`. NVIDIA's CUDA driver opens `/dev/nvidia-uvm` as part of ordinary context creation — required by `gst-plugins-bad`'s `nvcodec` plugin (`nvh264dec` etc.) for both decoding and the CUDA/GL interop it uses to hand frames to WebKit's compositor as zero-copy `GLMemory`. Without it, hardware video decode fails to initialize inside the sandbox, and GStreamer's `decodebin` silently falls back to a software decoder — which, on this stack, has its own separate rendering bug that shows as a solid green video frame (filed separately against GStreamer; see the linked investigation doc).

This is a plain missing-entry gap in an existing allowlist, not a sandbox-policy question — every other device family already used for accelerated video (`/dev/dri`, `/dev/mali*`, V4L2 nodes) is bound the same way `/dev/nvidia-uvm` would need to be.

## Environment

- WebKitGTK 2.52.6 (patched locally with the [321683](https://bugs.webkit.org/show_bug.cgi?id=321683) sandbox null-pointer fix — this bug is independent of that one and reproduces with or without it)
- Ubuntu 26.04 LTS, kernel 7.0.0-31-generic
- NVIDIA GeForce GTX 1080, proprietary driver 580.178.04
- GStreamer 1.28.2, `gst-plugins-bad` `nvcodec` plugin (`nvh264dec`, rank `primary + 1 (257)`)

## Evidence

`strace -f -e trace=openat` on a working, unsandboxed `nvh264dec ! glupload ! glcolorconvert` pipeline decoding real H.264 content shows:

```
openat(..., "/dev/nvidia0", ...)
openat(..., "/dev/nvidiactl", ...)
openat(..., "/dev/nvidia-modeset", ...)
openat(..., "/dev/nvidia-uvm", ...)
```

`BubblewrapLauncher.cpp`'s current NVIDIA device list (`Source/WebKit/UIProcess/Launcher/glib/BubblewrapLauncher.cpp`, `bindOpenGL()`):

```cpp
// Nvidia
"--dev-bind-try", "/dev/nvidiactl", "/dev/nvidiactl",
"--dev-bind-try", "/dev/nvidia0", "/dev/nvidia0",
"--dev-bind-try", "/dev/nvidia", "/dev/nvidia",
```

Two of the four opened devices aren't in the allowlist.

## Proposed fix

```diff
         // Nvidia
         "--dev-bind-try", "/dev/nvidiactl", "/dev/nvidiactl",
         "--dev-bind-try", "/dev/nvidia0", "/dev/nvidia0",
         "--dev-bind-try", "/dev/nvidia", "/dev/nvidia",
+        "--dev-bind-try", "/dev/nvidia-uvm", "/dev/nvidia-uvm",
+        "--dev-bind-try", "/dev/nvidia-uvm-tools", "/dev/nvidia-uvm-tools",
+        "--dev-bind-try", "/dev/nvidia-modeset", "/dev/nvidia-modeset",
```

Full patch at `vtt-chat-app/docs/patches/webkitgtk-sandbox-missing-nvidia-uvm.patch`. `--dev-bind-try` is already a no-op for paths that don't exist, so this is safe on systems without an NVIDIA GPU/driver.

**Confirmed live, 2026-09-16:** rebuilt and installed, tested in Epiphany against real DDB video content — plays correctly (no green frame). `GST_DEBUG=GST_ELEMENT_FACTORY:4` confirms `nvh264dec` (hardware) is instantiated for every video tested (4/4), with no software-decoder fallback.

## Notes for triage

- Reproducible without any WebKit-specific test page — any `<video>` playing H.264 on an NVIDIA GPU inside the standard bubblewrap sandbox should hit this if hardware decode would otherwise have been used.
- Symptom in the browser is silent and easy to misattribute: no crash, no console error, video element reports playing, audio works — only the picture is wrong (solid color). Worth a comment noting this downstream effect for anyone searching by symptom rather than cause.
- `/dev/nvidia-uvm-tools` is included defensively (NVIDIA's own docs describe it as used by profiling/tools, not core context creation) — not independently confirmed to be required; happy to drop it if a maintainer confirms it's unnecessary.

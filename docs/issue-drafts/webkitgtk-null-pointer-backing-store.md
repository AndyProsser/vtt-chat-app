# Draft: [GTK] Null-pointer crash in AcceleratedBackingStore::update() handling EnterAcceleratedCompositingMode

**Target:** https://bugs.webkit.org/ — Component: `WebKitGTK`
**Status:** draft, not yet filed. Reviewed backtraces and source at `vtt-chat-app/docs/WEBKITGTK-NVIDIA-EGL-CRASH.md` (see "Symbolized backtraces (2026-09-11)").

---

## Summary

`AcceleratedBackingStore::update()` (`Source/WebKit/UIProcess/gtk/AcceleratedBackingStore.cpp:808`) dereferences a null `this` while the UI process is handling an `EnterAcceleratedCompositingMode` IPC message from the WebProcess, crashing the whole UI process with SIGSEGV. Reliably reproducible within 5-10 seconds of loading a YouTube watch page.

This was found while investigating a separate NVIDIA-driver-specific crash (`libnvidia-eglcore`), but this particular crash has **no GPU vendor involvement on its stack at all** — every frame is WebKit/GLib code, and the fault is a plain null-pointer dereference. It's very likely reproducible on any GPU/driver, not just NVIDIA; that hasn't been directly confirmed yet (see "Notes for triage" below).

## Environment

- WebKitGTK 2.52.6 (`2.52.6-0ubuntu0.26.04.1`), `webkit2gtk-4.1`. Also confirmed on 2.52.3 and 2.52.5 in earlier testing (see the linked doc's revision history).
- Ubuntu 26.04 LTS, kernel 7.0.0-31-generic
- Reproduced on both NVIDIA GTX 1080 (proprietary driver, 580 branch) and — for the *combined* crash sequence — ruled out as Intel-specific; see caveat below.
- Wayland (GNOME) and X11 (`GDK_BACKEND=x11`), same result.

## Steps to reproduce

```bash
/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser "https://www.youtube.com/watch?v=jNQXAC9IVRw"
```

No app code involved — reproduces in stock `MiniBrowser`, `epiphany --private-instance`, and `webkitgtk-6.0`'s `MiniBrowser` alike. Segfaults within roughly 5-10 seconds. Does **not** reproduce on the YouTube homepage, YouTube Shorts, or the YouTube embed player (`/embed/<id>?autoplay=1&mute=1`) playing the same video — the specific DOM/compositing condition on a watch page that triggers this hasn't been isolated.

## Backtrace (gdb, with `-dbgsym` symbols, `2.52.6-0ubuntu0.26.04.1`)

```
Program terminated with signal SIGSEGV, Segmentation fault.
#0  update () at Source/WebKit/UIProcess/gtk/AcceleratedBackingStore.cpp:808
#1  0x0000759fd022871b in enterAcceleratedCompositingMode () at Source/WebKit/UIProcess/WebPageProxy.cpp:12800
#2  0x0000759fd036cbef in enterAcceleratedCompositingMode () at Source/WebKit/UIProcess/CoordinatedGraphics/DrawingAreaProxyCoordinatedGraphics.cpp:261
#3  enterAcceleratedCompositingMode () at Source/WebKit/UIProcess/CoordinatedGraphics/DrawingAreaProxyCoordinatedGraphics.cpp:230
#4  0x0000759fcfc2d3d5 in operator()<unsigned long, WebKit::LayerTreeContext> () at Source/WebKit/Platform/IPC/HandleMessage.h:138
...
#10 handleMessage<Messages::DrawingAreaProxy::EnterAcceleratedCompositingMode, ...> () at Source/WebKit/Platform/IPC/HandleMessage.h:455
#11 didReceiveMessage () at build-gtk3/DerivedSources/WebKit/DrawingAreaProxyMessageReceiver.cpp:49
...
#15 dispatchMessage () at Source/WebKit/Platform/IPC/Connection.cpp:1423
#16 dispatchMessage () at Source/WebKit/Platform/IPC/Connection.cpp:1481
#17 dispatchIncomingMessages () at Source/WebKit/Platform/IPC/Connection.cpp:1600
...
#24 g_main_dispatch () at ../../../glib/gmain.c:3591
...
#28 g_application_run () at ../../../gio/gapplication.c:2742
#29 main () at Tools/MiniBrowser/gtk/main.c:1064
```

Disassembly of the faulting instruction (`update()+34`):

```
=> mov    0x48(%rdi),%rcx
```

`rdi` (the `this` pointer for `update()`) is `0x0` — confirmed independently via the kernel's own fault report (`segfault at 48`, matching the `0x48(%rdi)` offset exactly). This is called on the main thread, synchronously dispatching a received IPC message — not a background-thread race.

## Additional context that may help triage

- `enterAcceleratedCompositingMode()` is called twice in the trace (`WebPageProxy.cpp:12800` then `DrawingAreaProxyCoordinatedGraphics.cpp:261`/`230`) before reaching `AcceleratedBackingStore::update()` — worth checking whether the backing store is guaranteed to exist by the time this call chain reaches it, and under what page/timing condition that guarantee doesn't hold.
- This crash was originally found downstream of an unrelated NVIDIA driver bug (a separate `eglDestroyContext()` segfault, being reported to NVIDIA separately — see `docs/issue-drafts/nvidia-egldestroycontext-segfault.md` in the same repo if useful context). It's possible this null-pointer crash and that one are unconnected, or that this one is only reachable after some earlier failure specific to this test environment. Flagging in case it's relevant, not asserting a connection.
- Not yet confirmed whether this reproduces standalone on non-NVIDIA hardware — it very likely does, since nothing on this stack touches GPU-vendor code, but that hasn't been directly tested yet.

## Full investigation writeup

A much more detailed writeup, including the NVIDIA-side crash this was originally investigating, bisection across ~13 WebKit/driver-level toggles, and a positive control on Intel GPU, is available on request (internal doc, not yet public) — happy to share if useful for triage.

# Follow-up comment for bug 323949 (2026-09-11, updated 2026-09-12)

Posted after locally building and testing the fix proposed in bug 321683, then
confirmed in person on 2026-09-12 (audio/video playback, not just crash-free).
See `docs/WEBKITGTK-NVIDIA-EGL-CRASH.md`, section "Patch validated locally
(2026-09-11)" for the full writeup this summarizes.

---

Update: this is very likely the same bug as #321683, which already has the actual root cause — `document.startViewTransition()` as the first trigger of accelerated compositing reaches three `ASSERT()`-guarded null checks in `WebKitWebViewBase.cpp` that release builds silently strip.

I built and tested #321683's proposed fix locally against this exact reproduction:

- Patched `Source/WebKit/UIProcess/API/gtk/WebKitWebViewBase.cpp`, replacing the three `ASSERT(...)` calls in `webkitWebViewBaseEnterAcceleratedCompositingMode`/`UpdateAcceleratedCompositingMode`/`ExitAcceleratedCompositingMode` with `if (!webkitWebViewBase->priv->acceleratedBackingStore) return;`, matching the pattern two other functions in the same file already use.
- Built at the `webkitgtk-2.52.6` tag via the WebKit Container SDK (`--cmakeargs="-DUSE_LIBRICE=OFF"` needed to work around an unrelated missing dependency in the container image, not related to this bug).
- Ran the patched `MiniBrowser` against the same YouTube URL from this report, on the same NVIDIA GTX 1080 / driver 580.178.04 that reliably segfaults the stock 2.52.6 build within 5-10 seconds.

Result: zero crashes across 4 separate runs (one ran the full 65 seconds, confirmed still alive via the wrapping `timeout` command's exit code rather than just "didn't crash immediately"; three more shorter runs on top), confirmed via a clean kernel log (`journalctl -k`) each time — versus the stock build's 100%-reproducible dual segfault (the UI-process null-pointer crash here, plus a downstream NVIDIA `libnvidia-eglcore` crash in `eglDestroyContext()` that never gets reached once this one is fixed).

**Update, tested in person:** confirmed audio and video play back correctly with the patched build — no crash, and no rendering/playback regression versus stock. Also tried a second known-crashing page (an autoplaying-background-video homepage, unrelated to this report) with the same result: clean, no crash, full playback.

The patch (against the `webkitgtk-2.52.6` tag):

```diff
--- a/Source/WebKit/UIProcess/API/gtk/WebKitWebViewBase.cpp
+++ b/Source/WebKit/UIProcess/API/gtk/WebKitWebViewBase.cpp
@@ -2900,19 +2900,22 @@
 
 void webkitWebViewBaseEnterAcceleratedCompositingMode(WebKitWebViewBase* webkitWebViewBase, const LayerTreeContext& layerTreeContext)
 {
-    ASSERT(webkitWebViewBase->priv->acceleratedBackingStore);
+    if (!webkitWebViewBase->priv->acceleratedBackingStore)
+        return;
     webkitWebViewBase->priv->acceleratedBackingStore->update(layerTreeContext);
 }
 
 void webkitWebViewBaseUpdateAcceleratedCompositingMode(WebKitWebViewBase* webkitWebViewBase, const LayerTreeContext& layerTreeContext)
 {
-    ASSERT(webkitWebViewBase->priv->acceleratedBackingStore);
+    if (!webkitWebViewBase->priv->acceleratedBackingStore)
+        return;
     webkitWebViewBase->priv->acceleratedBackingStore->update(layerTreeContext);
 }
 
 void webkitWebViewBaseExitAcceleratedCompositingMode(WebKitWebViewBase* webkitWebViewBase)
 {
-    ASSERT(webkitWebViewBase->priv->acceleratedBackingStore);
+    if (!webkitWebViewBase->priv->acceleratedBackingStore)
+        return;
     webkitWebViewBase->priv->acceleratedBackingStore->update(LayerTreeContext());
 }
```

Happy to share full build/test details if useful for review.

---

Suggested short pointer for bug 321683:

> Independent build+test (including in-person audio/video playback confirmation) confirms this fix eliminates the crash — including a downstream NVIDIA driver crash that only happens as a consequence of this one. Patch and details on #323949.

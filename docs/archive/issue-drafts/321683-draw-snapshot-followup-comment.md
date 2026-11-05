# Follow-up comment + patch attachment for bug 321683 (drafted 2026-09-30)

**Target:** https://bugs.webkit.org/show_bug.cgi?id=321683 (not 323949 — this is the bug with
the actual root cause and the original reporter; 323949 already points there). Post as a
comment, then attach the diff below as a patch with the `review?` flag set (Bugzilla's
"Add an attachment" form, tick "patch", tick "request review from" and leave it blank for
triage to pick up) — that's what actually puts it in front of a reviewer/commit-queue, unlike
a diff pasted into a comment body (which is all that's happened on this bug and 323949 so far).

**Why this one and not a new bug:** same file, same defect class (`ASSERT()` that release
builds strip, guarding `priv->acceleratedBackingStore`), same underlying null-pointer crash —
found while re-validating this bug's own proposed fix against a second, independent
reproduction (a page entering accelerated compositing via video playback, not
`document.startViewTransition()`). Folding it into this bug instead of opening a fourth report
keeps the noise down and gives a reviewer the complete picture in one place.

---

## Comment text

> While independently re-validating this bug's proposed fix (see my comment on #323949 — same
> patch, built and tested locally, confirmed it eliminates the crash), I found a second,
> previously-unpatched instance of the exact same defect class in the same file: the paint/draw
> path.
>
> `webkitWebViewBaseDraw()` (GTK3) guards `priv->acceleratedBackingStore` with `ASSERT()` before
> calling `paint()` on it — same "compiles to nothing in release" problem this bug's patch fixes
> for the three `Enter`/`Update`/`ExitAcceleratedCompositingMode` functions, just not applied
> here. The parallel GTK4 path, `webkitWebViewBaseSnapshot()`, has the identical gap with **no
> guard at all**, not even an `ASSERT()`.
>
> Reproduced on a real page (not a synthetic test): with only this bug's three-site patch
> applied, a page that reaches accelerated compositing through ordinary video playback (rather
> than `startViewTransition()`) still crashes — same null-`this` signature, same offset, just a
> different call site:
>
> ```
> #0  WebKit::AcceleratedBackingStore::update(WebKit::LayerTreeContext const&) ()
> #1  WebKit::WebPageProxy::enterAcceleratedCompositingMode(WebKit::LayerTreeContext const&) ()
> #2  WebKit::DrawingAreaProxyCoordinatedGraphics::enterAcceleratedCompositingMode(...) ()
> ...
> rdi = 0x0   ; same null-this fault as this bug's own repro
> ```
>
> (That trace is actually the `Enter`-path fault from a stale rebuild that hadn't picked up this
> bug's own patch yet — worth flagging as its own lesson: after applying this bug's fix, verify
> the _compiled binary_ has the null check, e.g. via `objdump -d`, not just that the source tree
> does. Ninja's mtime tracking missed a stale object file for me after a `git stash` cycle and
> silently kept linking the pre-patch code.)
>
> Once the build was confirmed actually patched, the draw-path crash below is the real, distinct
> one — happens on first paint after entering compositing mode, patch's three guarded sites never
> involved:
>
> ```
> #0  WebKit::AcceleratedBackingStore::paint(cairo_t*, WebCore::IntRect const&) ()
> #1  webkitWebViewBaseDraw(GtkWidget*, cairo_t*) ()
> ```
>
> Patch, same style as this bug's own fix (guard, don't assert — confirmed safe because
> `DrawingAreaProxyCoordinatedGraphics::paint()`, the non-accelerated fallback both call sites
> fall through to, already early-returns when `isInAcceleratedCompositingMode()` is true, so
> skipping paint on a frame where the guard fails is a clean no-op, not a new risk):
>
> ```diff
> --- a/Source/WebKit/UIProcess/API/gtk/WebKitWebViewBase.cpp
> +++ b/Source/WebKit/UIProcess/API/gtk/WebKitWebViewBase.cpp
> @@ -894,8 +894,8 @@
>      bool notifyNextPresentationUpdate = false;
>      auto* pageSnapshot = gtk_snapshot_new();
>      if (!webViewBase->priv->isBlank) {
> -        if (drawingArea->isInAcceleratedCompositingMode())
> +        if (drawingArea->isInAcceleratedCompositingMode() && webViewBase->priv->acceleratedBackingStore)
>              notifyNextPresentationUpdate = webViewBase->priv->acceleratedBackingStore->snapshot(pageSnapshot);
>          else {
> @@ -943,9 +943,8 @@
>          if (showingNavigationSnapshot)
>              cairo_push_group(cr);
>
> -        if (drawingArea->isInAcceleratedCompositingMode()) {
> -            ASSERT(webViewBase->priv->acceleratedBackingStore);
> -            notifyNextPresentationUpdate = webViewBase->priv->acceleratedBackingStore->paint(cr, clipRect);
> +        if (drawingArea->isInAcceleratedCompositingMode() && webViewBase->priv->acceleratedBackingStore) {
> +            notifyNextPresentationUpdate = webViewBase->priv->acceleratedBackingStore->paint(cr, clipRect);
>          } else {
> ```
>
> Built and tested on GTK3 (`USE_GTK4=OFF`, this bug's actual target per the sandbox/GLX repro
> path): this specific crash is gone, confirmed via a live session that ran well past where it
> used to die on click. Not yet built against the GTK4 tree, but the same gap is real there too
> (`webkitWebViewBaseSnapshot()`, no guard at all) — happy to confirm that build too if useful.
>
> Full patch also attached to this comment. Combined with the fix already proposed for this bug,
> that's now four call sites in `WebKitWebViewBase.cpp` guarding the same field — might be worth
> a maintainer considering whether `AcceleratedBackingStore*` should be null-safe by construction
> (e.g. a null-object pattern) rather than patched call-site by call-site as each one turns up.

## Attachment

File: `docs/patches/webkitgtk-accelerated-backing-store-draw-snapshot-null-guard.patch`
(unchanged from the version already in this repo — reproduced above in the comment text for
convenience). Attach it via Bugzilla's "Add an attachment" form on 321683, mark it as a patch,
and request review.

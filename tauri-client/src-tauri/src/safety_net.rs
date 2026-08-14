/// JS-injected shell behaviour, applied at document-start on every page via
/// `initialization_script` in `lib.rs`. Four concerns, all of which must work on DDB pages
/// where the overlay bundle isn't mounted:
///
/// 1. Tracker/ad domain blocking (no network-level interception — see
///    docs/superpowers/specs/2026-08-08-tracker-video-safety-net-design.md for why).
/// 2. Neutralizing DDB's homepage background videos (WebKitGTK/NVIDIA segfault trigger — see
///    docs/WEBKITGTK-NVIDIA-EGL-CRASH.md).
/// 3. Stripping `target="_blank"` so those clicks become ordinary same-window navigations that
///    flow through `on_navigation`'s allowlist check (Stage 2 spec §2).
/// 4. The app-focused hotkey delivery path, needed because OS-level global shortcuts silently
///    do nothing on Wayland (Stage 2 spec, Amendment A).
pub const SCRIPT: &str = r#"
(function () {
  var blockedHosts = [
    // Observed live on real DDB pages via AdGuard filtering-log captures.
    'googletagmanager.com',
    'gsght.com',
    'datadoghq-browser-agent.com',
    'ketchcdn.com',
    // 'optimizely.com' deliberately NOT blocked, despite appearing in the AdGuard capture this
    // list was sourced from: confirmed live 2026-08-13 that blocking it breaks DDB's own nav
    // mega-menus (PLAY D&D / RULES / LIBRARY / COMMUNITY) — the panels toggle open but render
    // with a zero-size box, no content. DDB evidently uses Optimizely to gate what renders
    // inside them, not just as a passive analytics beacon, so blocking it is an ad-block false
    // positive against the site's own UI, not a tracker win. See ROADMAP.md's Stage 2 entry.
    'hotjar.com',
    // Near-universal ad/analytics infrastructure, blocked by every mainstream ad-blocker
    // regardless of site. A different category from the list above: these are not sourced
    // from a DDB-specific capture, so they are kept visibly separate from ones that are.
    'doubleclick.net',
    'googlesyndication.com',
    'google-analytics.com',
    'googletagservices.com',
    'adservice.google.com',
    'amazon-adsystem.com'
  ];

  function isBlockedUrl(url) {
    try {
      var host = new URL(url, location.href).hostname;
      for (var i = 0; i < blockedHosts.length; i++) {
        var domain = blockedHosts[i];
        if (host === domain || host.endsWith('.' + domain)) return true;
      }
    } catch (e) {}
    return false;
  }

  var originalFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (isBlockedUrl(url)) {
      return Promise.reject(new Error('blocked by vtt-chat-app safety net'));
    }
    return originalFetch.call(this, input, init);
  };

  var originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (isBlockedUrl(url)) {
      throw new Error('blocked by vtt-chat-app safety net');
    }
    return originalXhrOpen.apply(this, arguments);
  };

  function guardSrcProperty(proto) {
    var descriptor = Object.getOwnPropertyDescriptor(proto, 'src');
    if (!descriptor || !descriptor.set) return;
    Object.defineProperty(proto, 'src', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set: function (value) {
        if (isBlockedUrl(value)) return;
        descriptor.set.call(this, value);
      },
    });
  }
  guardSrcProperty(HTMLScriptElement.prototype);
  guardSrcProperty(HTMLImageElement.prototype);
  guardSrcProperty(HTMLIFrameElement.prototype);

  // DDB's autoplaying background videos segfault WebKitGTK on some Linux+NVIDIA setups.
  // CSS-module class names get a hashed suffix (e.g. "SiteWide_backgroundVideo__goaOV"),
  // so match by prefix rather than an exact class selector.
  function isTargetVideo(el) {
    return el.tagName === 'VIDEO' && /\bSiteWide_backgroundVideo/.test(el.className || '');
  }

  function neutralizeVideo(el) {
    try {
      if (el.pause) el.pause();
      var sources = el.querySelectorAll ? el.querySelectorAll('source') : [];
      for (var i = 0; i < sources.length; i++) sources[i].remove();
      el.removeAttribute('src');
      if (el.load) el.load();
    } catch (e) {}
  }

  function scanNode(node) {
    if (!(node instanceof Element)) return;
    if (isTargetVideo(node)) neutralizeVideo(node);
    if (node.querySelectorAll) {
      var videos = node.querySelectorAll('video');
      for (var i = 0; i < videos.length; i++) {
        if (isTargetVideo(videos[i])) neutralizeVideo(videos[i]);
      }
    }
  }

  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) scanNode(added[j]);
    }
  });
  observer.observe(document, { childList: true, subtree: true });

  // --- target="_blank" stripping -------------------------------------------------------
  // A new-window request may bypass on_new_window entirely depending on the webview backend,
  // which would let it escape the allowlist. Strip the target during the capture phase so the
  // click becomes an ordinary same-window navigation and flows through on_navigation instead.
  // No allow/deny logic here: that decision stays in allowlist.rs, in one place.
  document.addEventListener(
    'click',
    function (event) {
      var anchor = event.target && event.target.closest ? event.target.closest('a[target]') : null;
      if (anchor && anchor.target === '_blank') {
        anchor.removeAttribute('target');
      }
    },
    true
  );

  // --- hotkey delivery (app-focused path) ----------------------------------------------
  // OS-level global shortcuts are unavailable on Wayland, so the same bindings are also
  // handled here whenever the app window has focus. Both paths are idempotent by design.
  function invokeHotkey(action) {
    try {
      var internals = window.__TAURI_INTERNALS__;
      if (internals && internals.invoke) internals.invoke('hotkey_action', { action: action });
    } catch (e) {}
  }

  var pttHeld = false;

  document.addEventListener(
    'keydown',
    function (event) {
      // Auto-repeat would otherwise re-fire push-to-talk dozens of times per second.
      if (event.repeat) return;

      if (event.code === 'ControlLeft') {
        if (pttHeld) return;
        pttHeld = true;
        invokeHotkey('push_to_talk_pressed');
        return;
      }
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyM') {
        event.preventDefault();
        invokeHotkey('toggle_mute');
        return;
      }
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyO') {
        event.preventDefault();
        invokeHotkey('toggle_overlay');
      }
    },
    true
  );

  document.addEventListener(
    'keyup',
    function (event) {
      if (event.code === 'ControlLeft' && pttHeld) {
        pttHeld = false;
        invokeHotkey('push_to_talk_released');
      }
    },
    true
  );

  // If focus leaves while push-to-talk is held, the keyup never arrives and the mic would
  // stay open indefinitely. Closing it on blur is the safe failure direction for a hot mic.
  window.addEventListener('blur', function () {
    if (pttHeld) {
      pttHeld = false;
      invokeHotkey('push_to_talk_released');
    }
  });
})();
"#;

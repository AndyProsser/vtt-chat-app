/// Minimal, JS-injected mitigation — not Stage 2's real ad-blocker (no network-level request
/// interception; see docs/superpowers/specs/2026-08-08-tracker-video-safety-net-design.md).
/// Blocks the AdGuard-confirmed tracker domains and neutralizes DDB's homepage background
/// videos (the confirmed WebKitGTK segfault trigger — see DDB-AUTH.md and ROADMAP.md Stage 1
/// known issues). Applied on every platform via `initialization_script` in `lib.rs`.
pub const SCRIPT: &str = r#"
(function () {
  var blockedHosts = [
    'googletagmanager.com',
    'gsght.com',
    'datadoghq-browser-agent.com',
    'ketchcdn.com',
    'optimizely.com',
    'hotjar.com'
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
})();
"#;

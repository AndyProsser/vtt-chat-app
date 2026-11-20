/*
 * Runs before the app, in plain old JavaScript (no modern syntax) so that even a very old browser can read it.
 * If the browser lacks what the app needs, it shows a notice (the natural 1 picture) asking for a newer browser,
 * instead of leaving a blank page. "Open it anyway" remembers the choice for this tab.
 * What the app needs: ES modules, Array.at / Object.hasOwn / structuredClone (Safari 15.4+), 100dvh, and
 * CSS color-mix (Safari 16.2, Chrome and Edge 111, Firefox 113): the strictest of them.
 */
(function () {
  try {
    if (window.sessionStorage.getItem('vtt-old-browser-ok') === '1') return;
  } catch (e) {
    /* storage blocked: carry on and test */
  }

  function supports(property, value) {
    try {
      return !!(window.CSS && window.CSS.supports && window.CSS.supports(property, value));
    } catch (e) {
      return false;
    }
  }

  var modules = 'noModule' in document.createElement('script');
  var modern =
    modules &&
    typeof Object.hasOwn === 'function' &&
    typeof Array.prototype.at === 'function' &&
    typeof window.structuredClone === 'function' &&
    supports('height', '100dvh') &&
    supports('color', 'color-mix(in srgb, red, blue)');
  if (modern) return;

  window.__vttOldBrowser = true;

  function show() {
    var root = document.getElementById('root');
    if (root) root.style.display = 'none';
    var wrap = document.createElement('div');
    wrap.setAttribute('role', 'alert');
    wrap.style.cssText =
      'position:fixed;top:0;right:0;bottom:0;left:0;overflow:auto;' +
      'background:#150f24 url(/old-browser.jpg) center/cover no-repeat;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
      'display:flex;align-items:flex-end;justify-content:center;';
    var card = document.createElement('div');
    card.style.cssText =
      'box-sizing:border-box;width:100%;max-width:560px;margin:16px;padding:20px 22px;' +
      'background:rgba(21,15,36,0.92);color:#f1ecfb;border:1px solid #6e56cf;border-radius:14px;' +
      'line-height:1.5;font-size:15px;';
    var h = document.createElement('h1');
    h.style.cssText = 'margin:0 0 8px;font-size:22px;line-height:1.25;';
    h.appendChild(document.createTextNode('Critical fumble: this browser is too old'));
    var p1 = document.createElement('p');
    p1.style.cssText = 'margin:0 0 10px;';
    p1.appendChild(
      document.createTextNode(
        'VTT Chat needs a more recent browser to show this page properly. ' +
          'Please update yours, or open this address in another one: Chrome or Edge 111 or newer, ' +
          'Firefox 113 or newer, or Safari 16.2 or newer.',
      ),
    );
    var p2 = document.createElement('p');
    p2.style.cssText = 'margin:0;font-size:13px;opacity:0.8;';
    p2.appendChild(
      document.createTextNode(
        'On a Mac that cannot run a newer Safari, Firefox or Chrome work as well. The desktop app needs no browser at all.',
      ),
    );
    card.appendChild(h);
    card.appendChild(p1);
    card.appendChild(p2);
    if (modules) {
      var a = document.createElement('a');
      a.href = '#';
      a.style.cssText = 'display:inline-block;margin-top:12px;color:#c9baff;font-size:13px;';
      a.appendChild(document.createTextNode('Open it anyway (it may not look right)'));
      a.onclick = function () {
        try {
          window.sessionStorage.setItem('vtt-old-browser-ok', '1');
        } catch (e) {
          /* nothing to remember it in */
        }
        window.location.reload();
        return false;
      };
      card.appendChild(a);
    }
    wrap.appendChild(card);
    document.body.appendChild(wrap);
  }

  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show);
})();

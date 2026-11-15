import { useState } from 'react';

import { INSTALL_HINT_TEXT, installHintKind, isStandalone } from '../../lib/phone/installHint.js';
import { dismissInstallHint, installHintDismissed } from '../../lib/phone/storage.js';

/**
 * A one-line, dismissible nudge to put the web app on the home screen. Shown only in a phone or tablet browser
 * tab, never once installed, and never again after it is closed (remembered in this browser only).
 */
export function InstallHint() {
  const [hidden, setHidden] = useState(installHintDismissed);
  const kind = installHintKind(navigator.userAgent, navigator.maxTouchPoints, isStandalone());
  if (hidden || !kind) return null;
  return (
    <div className="phone-install" role="note">
      <span>{INSTALL_HINT_TEXT[kind]}</span>
      <button
        type="button"
        className="phone-install-close"
        aria-label="Dismiss"
        onClick={() => {
          dismissInstallHint();
          setHidden(true);
        }}
      >
        ×
      </button>
    </div>
  );
}

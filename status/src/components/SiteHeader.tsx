import { useEffect, useState } from 'react';

import { checkSignedIn } from '../lib/session.js';

/** The page header every page shares: the app's logo, its name, and where to go next. */
export function SiteHeader({
  current,
}: {
  current: 'chat' | 'download' | 'account' | 'status' | 'other';
}) {
  // Chat, Download and Account are for signed-in visitors only.
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    void checkSignedIn().then(setSignedIn);
  }, []);
  return (
    <header className="site-header">
      <a className="site-brand" href="/">
        <img src="/app-icon-192.png" alt="" width="36" height="36" />
        VTT Chat
      </a>
      <nav className="site-nav" aria-label="Site">
        {signedIn && (
          <a href="/app" aria-current={current === 'chat' ? 'page' : undefined}>
            Chat
          </a>
        )}
        {signedIn && (
          <a href="/download" aria-current={current === 'download' ? 'page' : undefined}>
            Download
          </a>
        )}
        {signedIn && (
          <a href="/account" aria-current={current === 'account' ? 'page' : undefined}>
            Account
          </a>
        )}
        <a href="/status" aria-current={current === 'status' ? 'page' : undefined}>
          Status
        </a>
      </nav>
    </header>
  );
}

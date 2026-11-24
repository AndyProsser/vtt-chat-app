import '@radix-ui/themes/styles.css';
import '@vtt-chat-app/ui-kit/fonts/core';
import '@vtt-chat-app/ui-kit/tokens.css';
import './styles/palette.css';
import './styles/theme.css';
import './styles/connect.css';
import './styles/markdown.css';

import { Theme } from '@radix-ui/themes';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { useSystemAppearance } from './hooks/useSystemAppearance.js';

import { ConnectDevicePage } from './components/ConnectDevicePage.js';
import { SiteHeader } from './components/SiteHeader.js';
import { LandingPage } from './components/LandingPage.js';
import { AccountPage } from './components/account/AccountPage.js';
import { DownloadPage } from './components/DownloadPage.js';
import { FullAppPage } from './components/FullAppPage.js';
import { EmailLinkPage } from './components/EmailLinkPage.js';
import { JoinPage } from './components/JoinPage.js';
import { NotFoundPage } from './components/NotFoundPage.js';
import { pageTitle, resolveRoute } from './lib/routes.js';

const container = document.getElementById('root');
if (!container) throw new Error('web: #root element missing from index.html');

/** Radix needs to be told light or dark; this follows the operating system (CLAUDE.md §4). */
function Root() {
  const appearance = useSystemAppearance();
  const route = resolveRoute(window.location.pathname);
  useEffect(() => {
    document.title = pageTitle(route);
  }, [route]);
  return (
    <Theme appearance={appearance} accentColor="violet" radius="large">
      <div className="site-shell">
        <SiteHeader
          current={route === 'download' ? 'download' : route === 'account' ? 'account' : 'other'}
        />
        <main className="site-column">
          {route === 'connect' ? (
            <ConnectDevicePage />
          ) : route === 'download' ? (
            <DownloadPage />
          ) : route === 'account' ? (
            <AccountPage />
          ) : route === 'full-app' ? (
            <FullAppPage />
          ) : route === 'landing' ? (
            <LandingPage />
          ) : route === 'join' ? (
            <JoinPage />
          ) : route === 'email-signin' || route === 'reset-password' ? (
            <EmailLinkPage kind={route === 'reset-password' ? 'reset' : 'signin'} />
          ) : (
            <NotFoundPage />
          )}
        </main>
      </div>
    </Theme>
  );
}

// An old browser was shown a notice by /old-browser.js (before this ran): do not start the app behind it.
if (!(window as { __vttOldBrowser?: boolean }).__vttOldBrowser)
  createRoot(container).render(<Root />);

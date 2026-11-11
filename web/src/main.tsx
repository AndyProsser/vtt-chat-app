import '@radix-ui/themes/styles.css';
import './styles/palette.css';
import './styles/theme.css';
import './styles/connect.css';

import { Theme } from '@radix-ui/themes';
import { createRoot } from 'react-dom/client';

import { useSystemAppearance } from './hooks/useSystemAppearance.js';

import { ConnectDevicePage } from './components/ConnectDevicePage.js';
import { SiteHeader } from './components/SiteHeader.js';
import { LandingPage } from './components/LandingPage.js';
import { DownloadPage } from './components/DownloadPage.js';
import { FullAppPage } from './components/FullAppPage.js';
import { JoinPage } from './components/JoinPage.js';

const container = document.getElementById('root');
if (!container) throw new Error('web: #root element missing from index.html');

/** Radix needs to be told light or dark; this follows the operating system (CLAUDE.md §4). */
function Root() {
  const appearance = useSystemAppearance();
  const page = window.location.pathname.replace(/\/+$/, '');
  return (
    <Theme appearance={appearance} accentColor="violet" radius="large">
      <div className="site-shell">
        <SiteHeader current={page === '/download' ? 'download' : 'other'} />
        <main className="site-column">
          {page === '/connect' ? (
            <ConnectDevicePage />
          ) : page === '/download' ? (
            <DownloadPage />
          ) : page === '/full-app' ? (
            <FullAppPage />
          ) : page === '' ? (
            <LandingPage />
          ) : (
            <JoinPage />
          )}
        </main>
      </div>
    </Theme>
  );
}

createRoot(container).render(<Root />);

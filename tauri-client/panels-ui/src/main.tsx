import '@radix-ui/themes/styles.css';
import '@fontsource/cinzel/600.css';
import './styles/tokens.css';
import './styles/theme.css';
import './styles/main.css';
import './lib/languageFonts.js';

import { createRoot } from 'react-dom/client';

import { AppRoot } from './components/AppRoot.js';
import { applyStoredTheme, followThemeChangesFromOtherWindows } from './lib/themeStore.js';
import { windowReady } from './lib/tauriBridge.js';

const container = document.getElementById('root');
if (!container) throw new Error('panels-ui: #root element missing from index.html');

applyStoredTheme();
followThemeChangesFromOtherWindows();

createRoot(container).render(<AppRoot />);

// Windows start hidden; show this one after the first frame has actually been painted.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    void windowReady().catch((e: unknown) => console.error('[panels-ui] window_ready failed', e));
  });
});

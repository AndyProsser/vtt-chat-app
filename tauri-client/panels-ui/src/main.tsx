import '@radix-ui/themes/styles.css';
import '@fontsource/cinzel/600.css';
import './styles/tokens.css';
import './styles/theme.css';
import './styles/main.css';

import { createRoot } from 'react-dom/client';

import { AppRoot } from './components/AppRoot.js';
import { applyStoredTheme } from './lib/themeStore.js';
import { themeCss } from './lib/themes.js';

const container = document.getElementById('root');
if (!container) throw new Error('panels-ui: #root element missing from index.html');

const style = document.createElement('style');
style.textContent = themeCss();
document.head.append(style);
applyStoredTheme();

createRoot(container).render(<AppRoot />);

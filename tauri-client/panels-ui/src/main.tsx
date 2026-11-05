import '@radix-ui/themes/styles.css';
import './styles/theme.css';

import { Theme } from '@radix-ui/themes';
import { createRoot } from 'react-dom/client';

import { PanelRoot } from './components/PanelRoot.js';

const container = document.getElementById('root');
if (!container) throw new Error('panels-ui: #root element missing from index.html');

// `appearance="inherit"` follows the OS light/dark preference (CLAUDE.md §4) instead of forcing one.
createRoot(container).render(
  <Theme appearance="inherit" accentColor="gray">
    <PanelRoot />
  </Theme>,
);

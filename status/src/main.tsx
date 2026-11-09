import '@radix-ui/themes/styles.css';
import './styles/theme.css';

import { Theme } from '@radix-ui/themes';
import { createRoot } from 'react-dom/client';

import { StatusPage } from './components/StatusPage.js';

const container = document.getElementById('root');
if (!container) throw new Error('status: #root element missing from index.html');

// `appearance="inherit"` follows the OS light/dark preference (CLAUDE.md §4).
createRoot(container).render(
  <Theme appearance="inherit" accentColor="violet" radius="large">
    <StatusPage />
  </Theme>,
);

import '@radix-ui/themes/styles.css';
import './styles/theme.css';

import { Theme } from '@radix-ui/themes';
import { createRoot } from 'react-dom/client';

import { useSystemAppearance } from './hooks/useSystemAppearance.js';

import { StatusPage } from './components/StatusPage.js';

const container = document.getElementById('root');
if (!container) throw new Error('status: #root element missing from index.html');

/** Radix needs to be told light or dark; this follows the operating system (CLAUDE.md §4). */
function Root() {
  const appearance = useSystemAppearance();
  return (
    <Theme appearance={appearance} accentColor="violet" radius="large">
      <StatusPage />
    </Theme>
  );
}

createRoot(container).render(<Root />);

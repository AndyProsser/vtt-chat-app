import '@radix-ui/themes/styles.css';
import './styles/palette.css';
import './styles/theme.css';
import './styles/phone.css';

import { Theme } from '@radix-ui/themes';
import { createRoot } from 'react-dom/client';

import { useSystemAppearance } from './hooks/useSystemAppearance.js';

import { PhoneApp } from './components/phone/PhoneApp.js';

const container = document.getElementById('root');
if (!container) throw new Error('web: #root element missing from app.html');

/** Radix needs to be told light or dark; this follows the operating system (CLAUDE.md §4). */
function Root() {
  const appearance = useSystemAppearance();
  return (
    <Theme appearance={appearance} accentColor="violet" radius="large">
      <PhoneApp />
    </Theme>
  );
}

createRoot(container).render(<Root />);

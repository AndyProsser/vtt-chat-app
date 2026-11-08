import { Theme } from '@radix-ui/themes';

import { useSystemAppearance } from '../hooks/useSystemAppearance.js';
import { PanelRoot } from './PanelRoot.js';

/** Radix gets the OS appearance explicitly: `appearance="inherit"` does not follow the OS by itself. */
export function AppRoot() {
  const appearance = useSystemAppearance();
  return (
    <Theme appearance={appearance} accentColor="gray" radius="large">
      <PanelRoot />
    </Theme>
  );
}

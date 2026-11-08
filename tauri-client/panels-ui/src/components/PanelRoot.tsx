import { panelFromHash } from '../lib/panelName.js';
import { AccountPanel } from './AccountPanel.js';
import { HandoutsPanel } from './HandoutsPanel.js';
import { LootPanel } from './LootPanel.js';
import { MainWindow } from './MainWindow.js';

export function PanelRoot() {
  switch (panelFromHash(window.location.hash)) {
    case 'settings':
      return <AccountPanel />;
    case 'handouts':
      return <HandoutsPanel />;
    case 'inventory':
      return <LootPanel />;
    default:
      return <MainWindow />;
  }
}

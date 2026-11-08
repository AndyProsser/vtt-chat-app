import { panelFromHash } from '../lib/panelName.js';
import { HandoutsPanel } from './HandoutsPanel.js';
import { LootPanel } from './LootPanel.js';
import { MainWindow } from './MainWindow.js';
import { SettingsWindow } from './SettingsWindow.js';

export function PanelRoot() {
  switch (panelFromHash(window.location.hash)) {
    case 'settings':
      return <SettingsWindow />;
    case 'handouts':
      return <HandoutsPanel />;
    case 'inventory':
      return <LootPanel />;
    default:
      return <MainWindow />;
  }
}

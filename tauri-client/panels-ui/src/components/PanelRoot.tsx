import { panelFromHash } from '../lib/panelName.js';
import { HandoutsPanel } from './HandoutsPanel.js';
import { HandoutViewer } from './HandoutViewer.js';
import { HistoryPanel } from './HistoryPanel.js';
import { LootPanel } from './LootPanel.js';
import { MainWindow } from './MainWindow.js';
import { SettingsWindow } from './SettingsWindow.js';

export function PanelRoot() {
  switch (panelFromHash(window.location.hash)) {
    case 'settings':
      return <SettingsWindow />;
    case 'handouts':
      return (
        <div className="vtt-settings">
          <HandoutsPanel />
        </div>
      );
    case 'handout':
      return <HandoutViewer />;
    case 'history':
      return (
        <div className="vtt-settings">
          <HistoryPanel />
        </div>
      );
    case 'inventory':
      return (
        <div className="vtt-settings">
          <LootPanel />
        </div>
      );
    default:
      return <MainWindow />;
  }
}

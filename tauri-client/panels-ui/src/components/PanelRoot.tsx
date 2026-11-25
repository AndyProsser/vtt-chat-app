import { panelFromHash } from '../lib/panelName.js';
import { HandoutsPanel } from './HandoutsPanel.js';
import { HandoutViewer } from './HandoutViewer.js';
import { HistoryPanel } from './HistoryPanel.js';
import { LootPanel } from './LootPanel.js';
import { MainWindow } from './MainWindow.js';
import { GmNotesPanel } from './notes/GmNotesPanel.js';
import { SessionWindow } from './SessionWindow.js';
import { SettingsWindow } from './SettingsWindow.js';

export function PanelRoot() {
  switch (panelFromHash(window.location.hash)) {
    case 'settings':
      return <SettingsWindow />;
    case 'handouts':
      return (
        <div className="vtt-settings vtt-panel-pad">
          <HandoutsPanel />
        </div>
      );
    case 'handout':
      return <HandoutViewer />;
    case 'session':
      return <SessionWindow />;
    case 'history':
      return (
        <div className="vtt-settings vtt-panel-pad">
          <HistoryPanel />
        </div>
      );
    case 'inventory':
      return (
        <div className="vtt-settings vtt-panel-pad">
          <LootPanel />
        </div>
      );
    case 'notes':
      return (
        <div className="vtt-settings vtt-panel-pad">
          <GmNotesPanel />
        </div>
      );
    default:
      return <MainWindow />;
  }
}

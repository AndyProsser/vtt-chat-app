import type { PanelName } from '../consts/index.js';
import { AccountPanel } from './AccountPanel.js';
import { ChatPanel } from './ChatPanel.js';
import { RosterPanel } from './RosterPanel.js';

/** Which panel this window is: the URL hash set by `src-tauri/src/windows.rs` (`index.html#chat`). */
export function panelFromHash(hash: string): PanelName {
  const name = hash.replace(/^#/, '');
  return name === 'chat' || name === 'roster' ? name : 'account';
}

export function PanelRoot() {
  switch (panelFromHash(window.location.hash)) {
    case 'chat':
      return <ChatPanel />;
    case 'roster':
      return <RosterPanel />;
    default:
      return <AccountPanel />;
  }
}

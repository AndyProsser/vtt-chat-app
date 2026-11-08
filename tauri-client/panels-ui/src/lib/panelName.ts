import { PANEL_NAMES, type PanelName } from '../consts/index.js';

/** Which window this is: the URL hash set by `src-tauri/src/windows.rs` (`index.html#settings`). */
export function panelFromHash(hash: string): PanelName {
  const name = hash.replace(/^#/, '');
  return (PANEL_NAMES as readonly string[]).includes(name) ? (name as PanelName) : 'main';
}

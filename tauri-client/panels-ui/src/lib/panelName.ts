import { PANEL_NAMES, type PanelName } from '../consts/index.js';

/** Which window this is: the URL hash set by `src-tauri/src/windows.rs` (`index.html#settings`). */
export function panelFromHash(hash: string): PanelName {
  const name = hash.replace(/^#/, '').split('/')[0] ?? '';
  return (PANEL_NAMES as readonly string[]).includes(name) ? (name as PanelName) : 'main';
}

/** The handout a viewer window was opened for (`#handout/<id>`), if the id is a plain one. */
export function handoutIdFromHash(hash: string): string | undefined {
  const match = /^#handout\/([A-Za-z0-9_-]{1,64})$/.exec(hash);
  return match?.[1];
}

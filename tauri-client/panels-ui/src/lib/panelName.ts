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

const SESSION_HASH = /^#session\/([A-Za-z0-9_-]{1,64})(?:\/([a-z]{1,10}))?$/;
const SESSION_TABS = ['tale', 'heroes', 'story', 'notes'] as const;

/** The recorded session a history window was opened for (`#session/<id>`, optionally `/<tab>`), if the id is a plain one. */
export function sessionIdFromHash(hash: string): string | undefined {
  return SESSION_HASH.exec(hash)?.[1];
}

/** The tab a history window should open on (`#session/<id>/heroes`); nothing for none, or for a name that is not a tab. */
export function sessionTabFromHash(hash: string): (typeof SESSION_TABS)[number] | undefined {
  const tab = SESSION_HASH.exec(hash)?.[2];
  return SESSION_TABS.find((t) => t === tab);
}

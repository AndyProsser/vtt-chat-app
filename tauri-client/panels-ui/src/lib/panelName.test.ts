import { describe, expect, it } from 'vitest';

import {
  handoutIdFromHash,
  panelFromHash,
  sessionIdFromHash,
  sessionTabFromHash,
} from './panelName.js';

describe('panelFromHash', () => {
  it('reads the window names', () => {
    for (const name of ['main', 'settings', 'handouts', 'history', 'inventory', 'notes']) {
      expect(panelFromHash(`#${name}`)).toBe(name);
    }
  });
  it('reads a handout viewer window and its id, and rejects an id that is not plain', () => {
    expect(panelFromHash('#handout/abc-123')).toBe('handout');
    expect(handoutIdFromHash('#handout/abc-123')).toBe('abc-123');
    expect(handoutIdFromHash('#handout/../x')).toBeUndefined();
    expect(handoutIdFromHash('#handouts')).toBeUndefined();
  });
  it('reads a session window and its id, and rejects an id that is not plain', () => {
    expect(panelFromHash('#session/0b9f-42_A')).toBe('session');
    expect(sessionIdFromHash('#session/0b9f-42_A')).toBe('0b9f-42_A');
    expect(sessionIdFromHash('#session/../x')).toBeUndefined();
    expect(sessionIdFromHash('#session/')).toBeUndefined();
    expect(sessionIdFromHash('#history')).toBeUndefined();
  });
  it('reads the tab a session window should open on, and ignores one that is not a tab', () => {
    expect(sessionIdFromHash('#session/abc/heroes')).toBe('abc');
    expect(sessionTabFromHash('#session/abc/heroes')).toBe('heroes');
    expect(sessionTabFromHash('#session/abc/notes')).toBe('notes');
    expect(sessionTabFromHash('#session/abc')).toBeUndefined();
    expect(sessionTabFromHash('#session/abc/elsewhere')).toBeUndefined();
    expect(sessionTabFromHash('#session/abc/heroes/more')).toBeUndefined();
  });
  it('shows the main window for an empty or retired or unknown hash', () => {
    expect(panelFromHash('')).toBe('main');
    expect(panelFromHash('#chat')).toBe('main');
    expect(panelFromHash('#../x')).toBe('main');
  });
});

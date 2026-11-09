import { describe, expect, it } from 'vitest';

import { DEFAULT_PANELS, parsePanels, togglePanel } from './deckPanels.js';

describe('deck panels', () => {
  it('starts with Voice alone', () => {
    expect(DEFAULT_PANELS).toEqual({ voice: true, stingers: false, scenes: false });
  });
  it('restores what was saved, ignoring anything it does not understand', () => {
    expect(parsePanels('{"voice":false,"stingers":true,"scenes":true}')).toEqual({
      voice: false,
      stingers: true,
      scenes: true,
    });
    expect(parsePanels('{"stingers":true,"extra":1,"scenes":"yes"}')).toEqual({
      voice: true,
      stingers: true,
      scenes: false,
    });
    for (const bad of [null, '', 'nope', '[]', '42'])
      expect(parsePanels(bad)).toEqual(DEFAULT_PANELS);
  });
  it('flips one panel and leaves the others', () => {
    expect(togglePanel(DEFAULT_PANELS, 'scenes')).toEqual({
      voice: true,
      stingers: false,
      scenes: true,
    });
    expect(togglePanel({ voice: true, stingers: true, scenes: true }, 'voice').voice).toBe(false);
  });
});

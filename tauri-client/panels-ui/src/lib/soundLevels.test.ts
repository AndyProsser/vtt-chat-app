import { describe, expect, it } from 'vitest';

import { DEFAULT_LEVELS, parseLevels } from './soundLevels.js';

describe('sound levels', () => {
  it('defaults to loud stingers over quieter scenes', () => {
    expect(DEFAULT_LEVELS).toEqual({ stingers: 0.85, scenes: 0.55 });
  });
  it('restores saved levels and clamps them into 0 to 1', () => {
    expect(parseLevels('{"stingers":0.5,"scenes":0.25}')).toEqual({ stingers: 0.5, scenes: 0.25 });
    expect(parseLevels('{"stingers":3,"scenes":-1}')).toEqual({ stingers: 1, scenes: 0 });
  });
  it('falls back per field for anything it cannot read', () => {
    expect(parseLevels('{"stingers":"loud"}')).toEqual(DEFAULT_LEVELS);
    for (const bad of [null, '', '{', '[]']) expect(parseLevels(bad)).toEqual(DEFAULT_LEVELS);
  });
});

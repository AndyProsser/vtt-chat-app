import { describe, expect, it } from 'vitest';

import { laneAt } from './laneAt.js';

const el = (lane?: string) => {
  const e = document.createElement('div');
  if (lane !== undefined) e.dataset.lane = lane;
  return e;
};

describe('laneAt', () => {
  it('finds the first drop target under the pointer, from the topmost element down', () => {
    expect(laneAt([el(), el('p1'), el('main')])).toBe('p1');
  });
  it('knows the main party and the new-group zone', () => {
    expect(laneAt([el('main')])).toBe('main');
    expect(laneAt([el('new')])).toBe('new');
  });
  it('is undefined over nothing droppable', () => {
    expect(laneAt([el(), el()])).toBeUndefined();
    expect(laneAt([])).toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';

import { isPageVisible, watchPageVisibility } from './pageVisibility.js';

function fakeDoc(state: DocumentVisibilityState): Document {
  const doc = new EventTarget() as unknown as { visibilityState: DocumentVisibilityState };
  doc.visibilityState = state;
  return doc as unknown as Document;
}

describe('page visibility', () => {
  it('reads the current state', () => {
    expect(isPageVisible(fakeDoc('visible'))).toBe(true);
    expect(isPageVisible(fakeDoc('hidden'))).toBe(false);
  });

  it('reports each change and stops after unsubscribe', () => {
    const doc = fakeDoc('visible');
    const seen = vi.fn();
    const stop = watchPageVisibility(doc, seen);
    (doc as unknown as { visibilityState: string }).visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toHaveBeenLastCalledWith(false);
    stop();
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

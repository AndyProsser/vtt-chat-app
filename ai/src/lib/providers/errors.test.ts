import { describe, expect, it } from 'vitest';

import { isModelAbortMessage } from './errors.js';

describe('isModelAbortMessage', () => {
  it("recognises Ollama's own wording for a model that aborted on its own output", () => {
    expect(isModelAbortMessage('prediction aborted, token repeat limit reached')).toBe(true);
    expect(isModelAbortMessage('model runner has unexpectedly stopped: repeat limit')).toBe(true);
  });
  it('is false for an ordinary failure, so a real outage keeps its own classification', () => {
    expect(isModelAbortMessage('fetch failed')).toBe(false);
    expect(isModelAbortMessage('busy')).toBe(false);
    expect(isModelAbortMessage('')).toBe(false);
  });
});

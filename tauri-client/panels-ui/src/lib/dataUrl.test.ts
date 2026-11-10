import { describe, expect, it } from 'vitest';

import { bytesFromDataUrl } from './dataUrl.js';

describe('bytesFromDataUrl', () => {
  it('decodes the base64 part', () => {
    expect([...(bytesFromDataUrl('data:application/pdf;base64,JVBERg==') ?? [])]).toEqual([
      0x25, 0x50, 0x44, 0x46,
    ]);
  });
  it('refuses anything that is not a base64 data URL', () => {
    expect(bytesFromDataUrl('https://example.com/x.pdf')).toBeUndefined();
    expect(bytesFromDataUrl('data:text/plain,hello')).toBeUndefined();
    expect(bytesFromDataUrl('data:application/pdf;base64,***')).toBeUndefined();
  });
});

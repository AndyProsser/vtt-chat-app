import { describe, expect, it, vi } from 'vitest';

import { copyText } from './clipboard.js';

describe('copyText', () => {
  it('writes to the clipboard and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyText('sudo apt install ./x.deb', { writeText })).toBe(true);
    expect(writeText).toHaveBeenCalledWith('sudo apt install ./x.deb');
  });
  it('reports failure when the API is missing, rejects or throws', async () => {
    expect(await copyText('x', undefined)).toBe(false);
    expect(await copyText('x', { writeText: () => Promise.reject(new Error('denied')) })).toBe(
      false,
    );
    expect(
      await copyText('x', {
        writeText: () => {
          throw new Error('sync');
        },
      }),
    ).toBe(false);
  });
});

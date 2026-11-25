import { describe, expect, it } from 'vitest';

import { GM_NOTES_STARTER } from '../consts/index.js';
import { attachmentProblem, editorStart, isWebLink, sizeLabel } from './gmNotes.js';

describe('sizeLabel', () => {
  it('reads naturally', () => {
    expect(sizeLabel(12)).toBe('12 B');
    expect(sizeLabel(840 * 1024)).toBe('840 KB');
    expect(sizeLabel(3.24 * 1024 * 1024)).toBe('3.2 MB');
    expect(sizeLabel(48 * 1024 * 1024)).toBe('48 MB');
  });
});

describe('attachmentProblem', () => {
  const MB = 1024 * 1024;
  it('takes pictures and PDFs within the ceiling', () => {
    expect(attachmentProblem({ name: 'a.png', type: 'image/png', size: 5 }, MB)).toBeNull();
    expect(attachmentProblem({ name: 'a.pdf', type: 'application/pdf', size: 5 }, MB)).toBeNull();
    expect(attachmentProblem({ name: 'Scan.PDF', type: '', size: 5 }, MB)).toBeNull();
  });
  it('says why not', () => {
    expect(attachmentProblem({ name: 'a.zip', type: 'application/zip', size: 5 }, MB)).toMatch(
      /pictures/,
    );
    expect(attachmentProblem({ name: 'a.png', type: 'image/png', size: 0 }, MB)).toMatch(/empty/);
    expect(attachmentProblem({ name: 'a.png', type: 'image/png', size: 3 * MB }, MB)).toMatch(
      /up to 1\.0 MB|up to 1 MB/,
    );
  });
});

describe('isWebLink', () => {
  it('opens web links only', () => {
    expect(isWebLink('https://example.com/a')).toBe(true);
    expect(isWebLink('http://localhost:8080')).toBe(true);
    for (const bad of [
      'javascript:alert(1)',
      'file:///etc',
      '#section',
      '/relative',
      'mailto:a@b.c',
      undefined,
    ])
      expect(isWebLink(bad)).toBe(false);
  });
});

describe('editorStart', () => {
  it('starts an empty page with the starter headings, and leaves real text alone', () => {
    expect(editorStart('')).toBe(GM_NOTES_STARTER);
    expect(editorStart('  \n')).toBe(GM_NOTES_STARTER);
    expect(editorStart('# Mine')).toBe('# Mine');
  });
});

import { describe, expect, it } from 'vitest';

import { markdownHeadings } from './markdownHeadings.js';

describe('markdownHeadings', () => {
  it('lists headings with level and line, and tells repeated ones apart', () => {
    const md = '# Notes\n\ntext\n\n## Places\n### Inn ###\n## Places\n';
    expect(markdownHeadings(md)).toEqual([
      { level: 1, text: 'Notes', line: 0, nth: 0 },
      { level: 2, text: 'Places', line: 4, nth: 0 },
      { level: 3, text: 'Inn', line: 5, nth: 0 },
      { level: 2, text: 'Places', line: 6, nth: 1 },
    ]);
  });
  it('ignores code fences, hashtags and empty headings', () => {
    const md = '```\n# not a heading\n```\n#hashtag\n# \n~~~\n## nor this\n~~~\n## Real';
    expect(markdownHeadings(md).map((h) => h.text)).toEqual(['Real']);
  });
});

import { describe, expect, it } from 'vitest';

import type { InvitePreview } from '../../types/index.js';
import { ogMetaTags, plainBlurb, siteOgTags } from './ogTags.js';

const preview: InvitePreview = {
  campaignName: 'Strahd',
  consentVersion: '1',
  description: '',
  dmName: 'Dee',
  playerCount: 3,
};

describe('plainBlurb', () => {
  it('strips markdown and collapses whitespace', () => {
    expect(plainBlurb('# Hi **there**\n\n[a link](http://x) and ![img](http://y)')).toBe(
      'Hi there a link and',
    );
  });

  it('drops list markers', () => {
    expect(plainBlurb('Intro\n\n- one\n- two\n1. three')).toBe('Intro one two three');
  });

  it('cuts a long text on a word with an ellipsis, counting characters', () => {
    const cut = plainBlurb('word '.repeat(100));
    expect([...cut].length).toBeLessThanOrEqual(161);
    expect(cut.endsWith('…')).toBe(true);
    expect(plainBlurb('🐉'.repeat(160))).toBe('🐉'.repeat(160));
  });
});

describe('ogMetaTags', () => {
  const base = { publicUrl: 'https://vtt.test/', path: '/join/ABC' };

  it('names the campaign and the DM, with an absolute url and image', () => {
    const tags = ogMetaTags({ ...base, preview: { ...preview, description: 'Bring garlic.' } });
    expect(tags).toContain('content="Join Strahd on VTT Chat"');
    expect(tags).toContain('content="Dee is running Strahd. Bring garlic."');
    expect(tags).toContain('property="og:url" content="https://vtt.test/join/ABC"');
    expect(tags).toContain('property="og:image" content="https://vtt.test/og-banner.jpg"');
    expect(tags).toContain('summary_large_image');
  });

  it('falls back to a fixed line without a description, and drops the DM clause without a DM', () => {
    expect(ogMetaTags({ ...base, preview })).toContain(
      'Dee is running Strahd. Join the table on VTT Chat.',
    );
    expect(ogMetaTags({ ...base, preview: { ...preview, dmName: null } })).toContain(
      'content="Join the table on VTT Chat."',
    );
    expect(ogMetaTags({ ...base, preview: { ...preview, dmName: null } })).not.toContain(
      'undefined',
    );
  });

  it('is generic for no preview, and omits url and image without a public address', () => {
    const tags = ogMetaTags({ preview: null, publicUrl: undefined, path: '/join/x' });
    expect(tags).toContain('Join a table on VTT Chat');
    expect(tags).not.toContain('og:image');
    expect(tags).not.toContain('og:url');
  });
});

describe('siteOgTags', () => {
  it('gives any page the dragon card and a default description, with no title of its own', () => {
    const html = siteOgTags({ publicUrl: 'https://vtt.example/', path: '/download' });
    expect(html).toContain('property="og:title" content="VTT Chat"');
    expect(html).toContain('property="og:description" content="Voice, chat and session records');
    expect(html).toContain('property="og:image" content="https://vtt.example/og-banner.jpg"');
    expect(html).toContain('property="og:url" content="https://vtt.example/download"');
    expect(html).toContain('name="twitter:card"'.replace('name', 'property'));
    expect(html).not.toContain('<title>');
  });

  it('leaves out the image and address when no public address is configured', () => {
    const html = siteOgTags({ publicUrl: undefined, path: '/' });
    expect(html).not.toContain('og:image"');
    expect(html).not.toContain('og:url');
    expect(html).toContain('og:title');
  });
});

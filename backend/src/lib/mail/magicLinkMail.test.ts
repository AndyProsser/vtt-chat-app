import { describe, expect, it } from 'vitest';

import { magicLinkUrl, renderMagicLinkMail } from './magicLinkMail.js';

const message = { email: 'a@example.com', purpose: 'signin' as const, token: 'abc', expiresAt: 0 };

describe('magicLinkUrl', () => {
  it('puts the token in the fragment of the right page, with no doubled slash', () => {
    expect(magicLinkUrl('https://x.test/', 'signin', 'abc')).toBe(
      'https://x.test/email-signin#token=abc',
    );
    expect(magicLinkUrl('https://x.test', 'reset', 'a b')).toBe(
      'https://x.test/reset-password#token=a%20b',
    );
  });

  it('refuses to email a link code', () => {
    expect(() => magicLinkUrl('https://x.test', 'link', 'abc')).toThrow();
  });
});

describe('renderMagicLinkMail', () => {
  const mail = renderMagicLinkMail(message, 'https://x.test');

  it('has the link as a button and as plain text, the banner, and a dark mode', () => {
    expect(mail.html).toContain('href="https://x.test/email-signin#token=abc"');
    expect(mail.html).toContain('cid:vtt-banner');
    expect(mail.html).toContain('prefers-color-scheme');
    expect(mail.text).toContain('https://x.test/email-signin#token=abc');
    expect(mail.text).not.toContain('<');
  });

  it('states the lifetime of each kind of link and keeps the token out of the subject', () => {
    expect(mail.html).toContain('15 minutes');
    const reset = renderMagicLinkMail({ ...message, purpose: 'reset' }, 'https://x.test');
    expect(reset.html).toContain('60 minutes');
    expect(reset.subject).toMatch(/reset/i);
    expect(mail.subject).not.toContain('abc');
  });

  it('escapes whatever it is given', () => {
    const evil = renderMagicLinkMail(message, 'https://x.test/a"><script>alert(1)</script>');
    expect(evil.html).not.toContain('<script>');
    expect(evil.html).toContain('&#34;&#62;&#60;script');
  });
});

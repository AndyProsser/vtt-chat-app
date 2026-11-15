import { describe, expect, it } from 'vitest';

import { SmtpMailTransport, type MailerLike } from './smtpTransport.js';

const message = {
  email: 'a@example.com',
  purpose: 'signin' as const,
  token: 'TOKEN-123',
  expiresAt: 0,
};

type Sent = Parameters<MailerLike['sendMail']>[0];

describe('SmtpMailTransport', () => {
  it('sends the link as HTML and text, with the banner attached inline', async () => {
    const sent: Sent[] = [];
    const transport = new SmtpMailTransport(
      { sendMail: async (m) => void sent.push(m) },
      'VTT <v@example.com>',
      'https://x.test',
    );
    await transport.send(message);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'a@example.com', from: 'VTT <v@example.com>' });
    expect(sent[0]!.text).toContain('https://x.test/email-signin#token=TOKEN-123');
    expect(sent[0]!.html).toContain('cid:vtt-banner');
    expect(sent[0]!.attachments).toHaveLength(1);
    expect(sent[0]!.attachments[0]).toMatchObject({
      cid: 'vtt-banner',
      contentType: 'image/jpeg',
      contentDisposition: 'inline',
    });
  });

  it('logs a failure without the token or the address, and does not throw', async () => {
    const lines: string[] = [];
    const transport = new SmtpMailTransport(
      {
        sendMail: async () => {
          throw new Error('connection refused');
        },
      },
      'v@example.com',
      'https://x.test',
      (l) => lines.push(l),
    );
    await expect(transport.send(message)).resolves.toBeUndefined();
    expect(lines.join()).toContain('connection refused');
    expect(lines.join()).not.toContain('TOKEN-123');
    expect(lines.join()).not.toContain('a@example.com');
  });
});

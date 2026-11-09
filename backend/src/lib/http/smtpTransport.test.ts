import { describe, expect, it } from 'vitest';

import { renderMagicLinkMail, SmtpMailTransport } from './smtpTransport.js';

const message = {
  email: 'a@example.com',
  purpose: 'signin' as const,
  token: 'TOKEN-123',
  expiresAt: 0,
};

describe('SmtpMailTransport', () => {
  it('sends the code to the address with a plain-text body', async () => {
    const sent: Record<string, string>[] = [];
    const transport = new SmtpMailTransport(
      { sendMail: async (m) => void sent.push(m) },
      'VTT <v@example.com>',
    );
    await transport.send(message);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'a@example.com', from: 'VTT <v@example.com>' });
    expect(sent[0]!.text).toContain('TOKEN-123');
  });

  it('words each purpose differently and states the lifetime', () => {
    expect(renderMagicLinkMail({ ...message, purpose: 'reset' }).subject).toMatch(/reset/);
    expect(renderMagicLinkMail(message).text).toMatch(/expires in \d+ minutes/);
  });

  it('logs a failure without the code or the address, and does not throw', async () => {
    const lines: string[] = [];
    const transport = new SmtpMailTransport(
      {
        sendMail: async () => {
          throw new Error('connection refused');
        },
      },
      'v@example.com',
      (l) => lines.push(l),
    );
    await expect(transport.send(message)).resolves.toBeUndefined();
    expect(lines.join()).toContain('connection refused');
    expect(lines.join()).not.toContain('TOKEN-123');
    expect(lines.join()).not.toContain('a@example.com');
  });
});

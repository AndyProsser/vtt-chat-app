import nodemailer from 'nodemailer';

import { MAGIC_LINK_TTL_MINUTES } from '../../consts/index.js';
import type { MagicLinkPurpose } from '../../types/index.js';
import type { MagicLinkMessage, MagicLinkSender } from './delivery.js';

/** The slice of a nodemailer transport this needs, so tests can supply a fake. */
export interface MailerLike {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

const SUBJECTS: Record<MagicLinkPurpose, string> = {
  signin: 'Your VTT Chat sign-in code',
  reset: 'Your VTT Chat password reset code',
  link: 'Your VTT Chat link code',
};

const REASONS: Record<MagicLinkPurpose, string> = {
  signin: 'sign in to VTT Chat',
  reset: 'reset your VTT Chat password',
  link: 'link the VTT Chat app',
};

/** Plain text on purpose: a code to paste into the app, nothing to click, nothing to track. */
export function renderMagicLinkMail(message: MagicLinkMessage): { subject: string; text: string } {
  const reason = REASONS[message.purpose];
  return {
    subject: SUBJECTS[message.purpose],
    text: [
      `Use this code to ${reason}:`,
      '',
      `    ${message.token}`,
      '',
      `Paste it into the app. It works once and expires in ${MAGIC_LINK_TTL_MINUTES} minutes.`,
      "If you didn't ask for this, you can ignore this message: nobody can sign in without the code.",
      '',
    ].join('\n'),
  };
}

/**
 * Sends magic-link codes by email through the operator's own SMTP server (`SMTP_URL`). Optional:
 * without it the Admin CLI issues codes. The code is never logged; a failure is logged without the
 * recipient or the code, and does not tell the requester anything (the HTTP reply is identical
 * whether or not an account exists).
 */
export class SmtpMailTransport implements MagicLinkSender {
  constructor(
    private readonly mailer: MailerLike,
    private readonly from: string,
    private readonly log: (line: string) => void = (line) => console.warn(line),
  ) {}

  async send(message: MagicLinkMessage): Promise<void> {
    const { subject, text } = renderMagicLinkMail(message);
    try {
      await this.mailer.sendMail({ from: this.from, to: message.email, subject, text });
    } catch (error) {
      this.log(
        `[backend] could not send a ${message.purpose} email: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}

export function createSmtpMailTransport(url: string, from: string): SmtpMailTransport {
  return new SmtpMailTransport(nodemailer.createTransport(url) as MailerLike, from);
}

import nodemailer from 'nodemailer';

import { EMAIL_BANNER_CID, EMAIL_BANNER_JPEG_BASE64 } from '../../consts/emailBanner.js';
import { renderMagicLinkMail } from '../mail/magicLinkMail.js';
import type { MagicLinkMessage, MagicLinkSender } from './delivery.js';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  cid: string;
  contentType: string;
  contentDisposition: 'inline';
}

/** The slice of a nodemailer transport this needs, so tests can supply a fake. */
export interface MailerLike {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    attachments: MailAttachment[];
  }): Promise<unknown>;
}

const BANNER: MailAttachment = {
  filename: 'vtt-chat.jpg',
  content: Buffer.from(EMAIL_BANNER_JPEG_BASE64, 'base64'),
  cid: EMAIL_BANNER_CID,
  contentType: 'image/jpeg',
  contentDisposition: 'inline',
};

/**
 * Sends sign-in and password-reset links by email through the operator's own SMTP server (`SMTP_URL`):
 * HTML with the banner, plus a plain-text part. Optional: without it the Admin CLI issues codes. The token
 * is never logged; a failure is logged without the recipient or the token, and does not tell the requester
 * anything (the HTTP reply is identical whether or not an account exists).
 */
export class SmtpMailTransport implements MagicLinkSender {
  constructor(
    private readonly mailer: MailerLike,
    private readonly from: string,
    private readonly publicUrl: string,
    private readonly log: (line: string) => void = (line) => console.warn(line),
  ) {}

  async send(message: MagicLinkMessage): Promise<void> {
    try {
      const { subject, text, html } = renderMagicLinkMail(message, this.publicUrl);
      await this.mailer.sendMail({
        from: this.from,
        to: message.email,
        subject,
        text,
        html,
        attachments: [BANNER],
      });
    } catch (error) {
      this.log(
        `[backend] could not send a ${message.purpose} email: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}

export function createSmtpMailTransport(
  url: string,
  from: string,
  publicUrl: string,
): SmtpMailTransport {
  return new SmtpMailTransport(nodemailer.createTransport(url) as MailerLike, from, publicUrl);
}

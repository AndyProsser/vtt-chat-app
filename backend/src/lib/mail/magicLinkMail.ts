import { MAGIC_LINK_TTL_MINUTES, RESET_LINK_TTL_MINUTES } from '../../consts/index.js';
import type { MagicLinkPurpose } from '../../types/index.js';
import type { MagicLinkMessage } from '../http/delivery.js';
import { escapeHtml } from './escape.js';
import { emailLayout } from './layout.js';

/**
 * The address an emailed link opens. The token sits after the `#`, so it is never sent to the server in the
 * request, never lands in an access log or a Referer header, and a mail scanner that fetches the link gets
 * only the page, not a spent token. The page redeems it when the person presses its button.
 */
export function magicLinkUrl(publicUrl: string, purpose: MagicLinkPurpose, token: string): string {
  if (purpose === 'link') throw new Error('link codes are typed into the app, never emailed');
  const page = purpose === 'reset' ? 'reset-password' : 'email-signin';
  return `${publicUrl.replace(/\/+$/, '')}/${page}#token=${encodeURIComponent(token)}`;
}

const COPY = {
  signin: {
    subject: 'Sign in to VTT Chat',
    heading: 'Sign in to VTT Chat',
    intro: 'Press the button to sign in. It works once.',
    button: 'Sign in',
    minutes: MAGIC_LINK_TTL_MINUTES,
  },
  reset: {
    subject: 'Reset your VTT Chat password',
    heading: 'Reset your password',
    intro:
      'Press the button to choose a new password. It works once, and signs you out everywhere else.',
    button: 'Choose a new password',
    minutes: RESET_LINK_TTL_MINUTES,
  },
} as const;

const FOOTER = "If you didn't ask for this, ignore this email: nobody can get in without the link.";

export function renderMagicLinkMail(
  message: MagicLinkMessage,
  publicUrl: string,
): { subject: string; text: string; html: string } {
  const copy = COPY[message.purpose === 'reset' ? 'reset' : 'signin'];
  const url = magicLinkUrl(publicUrl, message.purpose, message.token);
  const expiry = `The link expires in ${copy.minutes} minutes.`;
  return {
    subject: copy.subject,
    text: [copy.intro, '', url, '', expiry, FOOTER, ''].join('\n'),
    html: emailLayout({
      title: copy.subject,
      preheader: `${copy.intro} ${expiry}`,
      heading: copy.heading,
      bodyHtml: `<p style="margin:0 0 16px;">${escapeHtml(copy.intro)} ${escapeHtml(expiry)}</p>`,
      buttonLabel: copy.button,
      buttonUrl: url,
      footer: FOOTER,
    }),
  };
}

import type { MagicLinkPurpose } from '../../types/index.js';

export interface MagicLinkMessage {
  email: string;
  purpose: MagicLinkPurpose;
  /** The secret. Whatever delivers it must not log it. */
  token: string;
  expiresAt: number;
}

/**
 * How a magic-link token reaches its owner: an email when SMTP is configured, or — with no mail
 * server — whatever the operator wires up (the CLI, where the DM reads the code out over a side
 * channel). The HTTP layer never returns the token in a response, so a sender is the only way out.
 */
export interface MagicLinkSender {
  send(message: MagicLinkMessage): Promise<void>;
}

/** Used when nothing is configured: the link is lost, and the operator is told why. */
export class NoMailTransport implements MagicLinkSender {
  private warned = false;

  async send(): Promise<void> {
    if (this.warned) return;
    this.warned = true;
    console.warn(
      '[backend] a magic link was requested but no mail transport is configured; ' +
        'it was not delivered. Configure SMTP or issue a code from the Admin CLI.',
    );
  }
}

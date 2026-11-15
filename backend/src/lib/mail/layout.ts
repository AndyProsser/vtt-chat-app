import { EMAIL_BANNER_CID } from '../../consts/emailBanner.js';
import { escapeHtml } from './escape.js';

// Radix "violet", the web app's accent, so the email looks like the place it links to.
const ACCENT = '#6e56cf';

export interface EmailLayoutInput {
  title: string;
  /** The grey preview line some mail apps show beside the subject. */
  preheader: string;
  heading: string;
  /** Already-escaped HTML paragraphs. */
  bodyHtml: string;
  buttonLabel: string;
  buttonUrl: string;
  footer: string;
}

/**
 * One small, boring, table-based layout: it has to survive Outlook and Gmail, which is why every style is
 * inline and the button is a coloured table cell rather than a styled link. Only a `<style>` block's dark
 * mode needs a modern client; elsewhere it simply stays light. The banner is a CID attachment, so it shows
 * with no remote fetch.
 */
export function emailLayout(input: EmailLayoutInput): string {
  const url = escapeHtml(input.buttonUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.title)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    body, .page { background: #17141f !important; }
    .card { background: #211d2d !important; }
    .text { color: #e6e1f0 !important; }
    .muted { color: #a29bb5 !important; }
    .link { color: #b9a7ff !important; }
  }
</style>
</head>
<body class="page" style="margin:0;padding:0;background:#f4f2f9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="page" style="background:#f4f2f9;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="card" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:0;line-height:0;"><img src="cid:${EMAIL_BANNER_CID}" width="600" alt="VTT Chat" style="display:block;width:100%;height:auto;border:0;"></td></tr>
    <tr><td class="text" style="padding:28px 32px 8px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#1c1a24;">
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">${escapeHtml(input.heading)}</h1>
      ${input.bodyHtml}
    </td></tr>
    <tr><td align="center" style="padding:8px 32px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" bgcolor="${ACCENT}" style="border-radius:8px;background:${ACCENT};">
          <a href="${url}" style="display:inline-block;padding:13px 28px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(input.buttonLabel)}</a>
        </td>
      </tr></table>
    </td></tr>
    <tr><td class="muted" style="padding:0 32px 28px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#6b6580;">
      <p style="margin:0 0 8px;">Button not working? Paste this address into your browser:</p>
      <p style="margin:0 0 16px;word-break:break-all;"><a class="link" href="${url}" style="color:${ACCENT};">${url}</a></p>
      <p style="margin:0;">${escapeHtml(input.footer)}</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>
`;
}

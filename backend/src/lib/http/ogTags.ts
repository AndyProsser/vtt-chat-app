import { OG_FALLBACK_BLURB } from '../../consts/index.js';
import type { InvitePreview } from '../../types/index.js';
import { escapeHtml } from '../mail/escape.js';

/**
 * A description reduced to one plain line for a chat app's link card: markdown syntax removed, whitespace
 * collapsed, cut on a word boundary with an ellipsis. Counts characters, not bytes.
 */
export function plainBlurb(markdown: string, max = 160): string {
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-+]|\d+\.)\s+/gm, '')
    .replace(/[#*_`>~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...text];
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The `<title>` and Open Graph tags for `/join/:code`, so a link pasted into Discord, WhatsApp or Messenger
 * unfurls into a card. With no preview (a bad, expired or rate-limited code) the tags are generic, so a
 * crawler learns nothing about which codes exist. `og:url` and `og:image` need an absolute address, so they
 * appear only when `publicUrl` is set. Every value is escaped; nothing here is trusted.
 */
export function ogMetaTags(input: {
  preview: InvitePreview | null;
  publicUrl: string | undefined;
  path: string;
}): string {
  const { preview, publicUrl } = input;
  const title = preview ? `Join ${preview.campaignName} on VTT Chat` : 'Join a table on VTT Chat';
  const blurb = preview ? plainBlurb(preview.description) || OG_FALLBACK_BLURB : OG_FALLBACK_BLURB;
  const description =
    preview && preview.dmName
      ? `${preview.dmName} is running ${preview.campaignName}. ${blurb}`
      : blurb;
  const tags: [string, string][] = [
    ['og:type', 'website'],
    ['og:site_name', 'VTT Chat'],
    ['og:title', title],
    ['og:description', description],
    ['twitter:card', 'summary_large_image'],
  ];
  if (publicUrl) {
    const base = publicUrl.replace(/\/+$/, '');
    tags.push(
      ['og:url', `${base}${input.path}`],
      ['og:image', `${base}/og-banner.jpg`],
      ['og:image:width', '1100'],
      ['og:image:height', '576'],
      ['og:image:alt', 'A dragon guarding a glowing d20'],
    );
  }
  return [
    '<title>Join | VTT Chat</title>',
    `<meta name="description" content="${escapeHtml(description)}">`,
    ...tags.map(([k, v]) => `<meta property="${k}" content="${escapeHtml(v)}">`),
  ].join('\n');
}

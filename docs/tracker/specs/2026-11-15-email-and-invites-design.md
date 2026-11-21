# Email, campaign details and group invites — design

**Decided 2026-11-15 with Andy.** Three pieces, built in this order, each with its own plan:

1. [Email: HTML mail, sign-in and reset links](../plans/2026-11-15-email-links.md)
2. [Campaign rename and description](../plans/2026-11-15-campaign-details.md)
3. [Group invite links: details on the page and Open Graph previews](../plans/2026-11-15-invite-page.md)

## Intent and why

- **Mail.** The server should send real email from `noreply@prosser.online` through the HomeLab notify relay
  (LXC 105, `10.0.20.105:25`, unauthenticated from `10.0.20.0/24`, Brevo upstream, domain-aligned for any
  `@prosser.online` sender), so password reset and emailed sign-in work.
- **Links, not codes, for anything clicked.** A long single-use token in a link for anything a person clicks;
  a short code (`ABCD-EFGH`) only where a person has to type or read one out (the DM handing one over, the app's
  typed-code box). Email never authenticates a desktop client directly: the link opens the **web app**, which signs
  the browser in; the desktop app is then connected from the signed-in web as it is today
  ([APP-SIGN-IN.md](../../architecture/APP-SIGN-IN.md)).
- **Invites.** A DM pastes one link into a group chat (Discord, WhatsApp, Messenger). Players tap it, see what the
  campaign is, and sign in or create an account. The link previews well in the chat.
- **Campaign details.** A DM can rename a campaign and give it a markdown description, in the app's Campaign
  settings tab. That description feeds the invite page.

## Goals / non-goals / anti-goals

- Goals: the above; self-host-first preserved (no cloud dependency in the default path; SMTP stays optional).
- Non-goals: editing the description from the phone web app (view only there, later); a web admin UI; tracking
  pixels; a public campaign directory (exists already for join requests, untouched).
- Anti-goals: a link that is burned by a mail scanner before the person clicks it; a sign-in or reset token in a
  server log, a Referer header or a browser history entry; an invite preview that leaks more than the invite page
  itself already shows.

## Decisions (mine unless marked Andy)

| Decision                                                                                                                                                                                                                  | Why                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Emailed links carry the token in the **URL fragment** (`#token=`), and the page redeems it with a POST **after a button press**                                                                                           | Mail scanners and chat unfurlers GET links; a fragment is never sent to the server, and a click-to-confirm survives scanners that run JavaScript. Cost: one extra click.                                  |
| Sign-in links live 15 minutes, reset links 60                                                                                                                                                                             | Mail can be slow; a reset is rarer and also needs a new password.                                                                                                                                         |
| `SMTP_URL` without `PUBLIC_URL` is a startup error                                                                                                                                                                        | Without it the server cannot build a link. SMTP was never exercised against a real server, so nobody relies on the old behaviour.                                                                         |
| Banner embedded as a **CID attachment**, JPEG, generated into a TS constant by a script (Andy: CID is fine, compress hard)                                                                                                | Works with no remote fetch and on every server (native or container); JPEG because Outlook and some Gmail views drop WebP.                                                                                |
| Banner art is the existing dragon-and-d20 hero (`web/src/assets/hero-1100.webp`), cropped (Andy)                                                                                                                          |                                                                                                                                                                                                           |
| Description max **4,000 characters** (Andy: fine as a ceiling), markdown with raw HTML dropped, no images, links shown as text                                                                                            | Same rules as handouts and notes.                                                                                                                                                                         |
| Description is visible to every member in the app, and **in full on the invite page**; the Open Graph preview carries only the campaign name, the DM's name and the first 160 characters of the description as plain text | The invite page already tells a code holder the campaign name; the group chat is the code's audience anyway. Anyone with the link can read it, so a DM should not put secrets in it (the editor says so). |
| Reachability: Cloudflare already provides external HTTPS; UDP is forwarded; links use `PUBLIC_URL` (Andy)                                                                                                                 |                                                                                                                                                                                                           |
| A wire change (new `description` field, `PATCH /api/campaigns/:id`, a bigger `GET /api/invites/:code`) bumps **MINOR**                                                                                                    | VERSIONING-AND-DEPLOYMENT.md. The release itself is cut separately and only when Andy asks.                                                                                                               |

## Approaches considered (mail links)

- **A. Fragment token, POST on click (chosen).** Safest against scanners and logs; one extra click.
- B. Server GET that redeems and sets the cookie. Simplest, but a scanner's GET burns the single-use token and the
  token lands in access logs. Rejected.
- C. Keep emailing a code to paste. Rejected by Andy: links for clicks.

## Left to the builder

Visual details of the HTML email and the invite page within the app's existing look (light/dark follows the OS),
copy wording, and exact CSS.

## Agreed during the build (2026-11-15)

- **Public / Private.** The DM's "Allow join" switch is relabelled Public / Private: Public tables are listed to existing players and take join requests. **Invite links always work, either way.**
- **Reset invite links.** The DM can revoke every invite still in use (`DELETE /api/campaigns/:id/invites`); people already in stay in.
- **A rename notifies connected clients** with a `campaign.updated` event, so names change everywhere without a restart.
- **Protocol 3.** These additions bump `PROTOCOL_VERSION` to 3; the release (and its MINOR bump) is cut separately.
- **Split DNS.** The internal and external hostnames are the same, so `PUBLIC_URL` is the one public name for every link.

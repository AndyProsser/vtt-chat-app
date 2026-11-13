# The phone app (web/)

A web app for reading and answering from a phone, served by the backend at **`https://<your domain>/app`**. It is
built for messages, not for play: chat, your whispers, sessions and your answer to each, handouts, and past
sessions with their summaries. **It carries no voice**; voice stays in the tray app, where the Rust audio engine
lives (CLAUDE.md §2: audio never goes through a webview).

Status: **built 2026-11-10 and exercised end to end in a phone-sized headless Chromium** against a real backend
and Postgres (sign in, read and send chat and a whisper, answer an RSVP, open a note and a picture handout, read a
summary and a transcript, in light and dark). **Not tried on a real phone or on iOS Safari.**

## What it does

| Tab      | Shows                                                                                         | Uses                                                                     |
| -------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Chat     | The table's chat and **your own** whispers in line; send to everyone or whisper to one person | `GET …/chat`, WebSocket `/ws` (`chat.message`, `chat.whisper`, snapshot) |
| Sessions | Upcoming sessions, how far off, who has answered, and **Can make it / Running late / Can't**  | `GET …/sessions`, `PUT …/sessions/:id/rsvp`                              |
| Handouts | What the DM has shown you: notes, picture sets and maps (pictures in order), PDFs             | `GET …/handouts`, `GET …/handouts/:id/files/:n`                          |
| History  | Past recordings, each one's summaries (DM-only ones appear for the DM only), the transcript   | `GET …/recordings`, `…/recordings/:id`, `…/recordings/:id/transcript`    |

Sign-in is by **email and password** or a **one-time code** (the same code a DM or operator issues for the tray
app). A changed recording notice is accepted on the sign-in screen. The session token is kept in this browser's
local storage (long-lived and remotely revocable, like the tray app's); **Menu → Sign out** ends it, and signing
the device out elsewhere (Settings → Sessions in the tray app) signs the phone out too.

## How it is built

- One more entry in the existing `web/` package (`app.html` + `src/phone.tsx`), sharing its build and assets with
  the invite page. Radix Themes, Zustand; the usual folders (`components/phone`, `lib/phone`, `hooks`, `consts`,
  `types`).
- **The live connection** (`lib/phone/socket.ts`) speaks the same WebSocket protocol as the tray app
  ([SYNC-PROTOCOL.md](SYNC-PROTOCOL.md)): `auth`, then `resume`, then frames. It always asks for a fresh
  snapshot and never replays a gap, because a phone is often asleep for minutes and the snapshot carries the
  recent chat and your whispers anyway. It reconnects by itself (1, 2, 5, 10, 30 s) and as soon as the page is
  visible again. Lines are de-duplicated by id, so history plus live never doubles a message.
- **Pictures** are fetched with the sign-in in a header and shown as data URLs, because an `<img src>` cannot send
  one. A **PDF** is fetched the same way and opened in the phone's own viewer in a new tab.
- **Hash-free routing:** there is one page and the tab is state, so the server only needs `/app`. `/join` and
  `/status` are untouched.
- **Policy for `/app`** is the join page's plus two allowances: `img-src … blob:` and
  `connect-src 'self' ws: wss:` (browsers differ on whether `'self'` covers a WebSocket). Nothing third-party,
  no inline script. Tested in `joinRoutes.test.ts`.
- `GET /api/auth/providers` now also returns `consentVersion`, so the sign-in screen can ask for a changed
  notice to be accepted. It is public and holds only a label.
- Light and dark follow the operating system. Radix's `inherit` appearance does **not** do that by itself, so a
  small hook (`useSystemAppearance`) tells it; the invite page and the status page had the same gap and use it too.

## Added after the first cut (2026-11-10)

- **History search.** A box above the session list; it waits for a pause in typing, then asks the records
  search (the same API and the same DM-only rule as the tray app). A hit shows who said or typed it and when,
  with the matched words highlighted, and opens that session. The server sends the snippet as escaped text with
  `<mark>` tags; the page splits it into parts and draws the marks itself, so it never treats text as HTML.
- **Handout viewer.** Tap a picture to open it full screen: flip between a set's pictures with the buttons or a
  sideways swipe (wrapping round), and zoom to pan around a map. A swipe only flips while the picture fits; when
  zoomed, a drag pans. It is always dark inside, in both themes.
- **Install to the home screen.** `/app.webmanifest`, three icons and the iOS meta tags. The server serves
  exactly those four files from the web folder and nothing else in it. There is deliberately **no service worker**:
  the app is live chat, so an offline shell would only show a stale page that cannot do anything. Whether a given
  browser offers "Install" without one is unverified; "Add to Home Screen" works without it on iOS and Android.

## Left out on purpose

Voice (above). Push notifications when the phone app is closed (a web page cannot be woken without a push
service, which would be a third party; the tray app is the answer for that). The DM's tools: those stay in the
tray app. Offline use. Pinch-zoom with two fingers inside the viewer is the browser's own; there is no custom
gesture code.

## Not verified

A real phone, iOS Safari, a long-running connection across sleep and wake, a very long chat, and the first load
over a slow connection (the JavaScript is about 140 KB compressed, most of it Radix).

## Reaching it, and the full app

The web app is the phone app: after signing in on the landing page, phones and tablets are handed straight into
`/app` already signed in (see the hand-off in [APP-SIGN-IN.md](APP-SIGN-IN.md)), and a computer can choose "Open
the web version instead". The public `/full-app` page explains what the desktop app adds (voice, the recording cue,
the soundboard, tray controls) and how to get it, with a copyable link to send to a computer; the phone menu links
to it.

## The Account page (`/account`, built 2026-11-13)

A framed page like `/download`, for a signed-in browser (signed out it shows the sign-in form). It links from the
header nav ("Account", web and status pages), the phone app's menu and the signed-in Home. Four cards:

- **Profile:** display name (1 to 80 characters) and portrait. A picked picture is cropped to a centred 256-pixel
  square and re-encoded in the browser, then uploaded like the desktop app does (`POST /api/avatars/upload`, then
  `PATCH /api/auth/me` with `avatar:<id>`); Remove clears it. A built-in emblem chosen in the desktop app cannot be
  drawn here, so the web shows initials and says so.
- **Security:** whether the account has a password, and set or change it (`POST /api/auth/password`, at least 10
  characters; an account that already has one must give the current one). **Changing it signs out every other
  device**, so a stolen session does not outlive the change; this one stays. The server rate-limits wrong guesses.
- **Devices:** every signed-in session (`GET /api/auth/sessions`): device label, signed in, last seen, a "This device"
  mark. Its own row's button is the normal Sign out. Each other device has a Sign out button, and "Sign out all other
  devices" (`POST /api/auth/sessions/revoke-others`) ends the rest. Both need **a second press** to confirm (the button
  changes to "Press again to sign out", and goes back after four seconds): no dialog, so it works the same by
  keyboard, screen reader or thumb. Device labels are text the device sent, so they are drawn as plain text in an
  isolated left-to-right span, never as markup.
- **Recording notice:** the version accepted and the date (`consentVersion`, `consentAt` on `/api/auth/me`; read-only,
  a changed notice is accepted at the next sign-in).

The two new routes and the `hasPassword` and `consentAt` fields are additive (`shared/protocol.contract.json`
updated inside 0.4). Not verified in a real browser: the page is built and unit-tested (`web/src/lib/account.ts`,
the backend routes), and `web/e2e/ui-smoke.mjs account` was written for it but has not been run.

## Look

The web app at `/app` is the same app on phones and desktop browsers. It has no voice or audio options; voice is
desktop-app-only. It shares the Home pages' look: the same header (logo and brand), page gradient and rounded card
column (max 640px, centred on wide screens), and a faint theme-tinted watermark of the desktop app's chat artwork
behind the content. Light and dark follow the OS; there is no theme choice in the web, because themes are a
desktop-app feature.

The pages' sign-in is tab-scoped and survives navigation. The phone hand-off still redeems a single-use link token
into the app's own session. The Download link appears in the nav only while signed in.

`/app` uses the same session cookie as the site, with nothing in `localStorage`. The `#connect=` link token is still
redeemed once and now sets the cookie. If the session ends the app returns to sign-in.

## Chat screen

- **Composer:** there is no recipient picker. Whispers are typed with `/tell`, `/w` or `/dm` (see
  [CHAT-COMMANDS.md](CHAT-COMMANDS.md)); every line goes through the shared parser.
- **Who is here:** the Chat tab shows who is at the table: a scrolling avatar strip under the header on a phone, a slim
  vertical rail beside the chat from 700px up. The data is the WebSocket roster (`snapshot` and `roster.update`), the
  same as the desktop rail. Avatars show an uploaded portrait or initials, a status dot (online, away, offline or
  disconnected) and a DM tag. There is no voice or speaking state: voice is desktop-only. Hovering with a mouse, or
  clicking or tapping, opens a details popout (DM mark, character, race, class and level, account name, status).
  Escape or an outside press closes it, and only one is open at a time.
- **Header:** a burger menu and a "Get the app" button, which goes to `/download` on a computer and `/full-app` on a
  phone or tablet.
- **Height:** the page never scrolls; the chat scrolls inside it (dynamic viewport height, so a phone's address bar
  does not push the bottom off screen).

## Layout and icons

- **Width:** from 520px up the app is a bordered, rounded card exactly 640px wide (border-box), with 16px side gutters
  and the same page background as Home, Download and Status. Below 520px (phones) it is full-bleed. The members rail
  still switches at 700px.
- **Bottom tabs** use the desktop app's lucide icons so the two read the same (Handouts = FileText, History =
  ScrollText, Sessions = CalendarClock; Chat = MessageSquare, since the desktop has no chat tab icon) with the label
  beneath. The icon paths live in `web/src/components/icons/paths.ts` (lucide, ISC licence).
- **Copy buttons** (`Command`) are icon-only, stretched to the height of the code box, with a tooltip ("Copy", then
  "Copied") and a tick for two seconds after copying.

## Asking to join a table

A signed-in person with no campaign sees, under the invite hint, the tables that take join requests (name, DM, player
count) with a Request to join button and an optional 280-character message. A person who already has campaigns reaches
the same list from the menu's "Find another table". A request shows as "Request sent" with Withdraw, and a refusal as
"Not this time" with the date they can ask again. The list refreshes every 20 seconds while visible, and `join.decided`
frames update it live for anyone with a campaign open; an approval shows a "You're in {table}" banner with a Switch
button. The DM of the open campaign gets a "Join requests" menu item with a pending-count badge (and a dot on the menu
icon), listing requests with Approve and Decline, recent decisions, and the Allow join switch.

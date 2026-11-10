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

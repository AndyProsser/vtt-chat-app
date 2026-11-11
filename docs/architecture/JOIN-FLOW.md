# First run: the browser join page

**Decided 2026-11-07.** First contact with an instance is in a **browser**, not in the app. After the
app is installed and the account exists, everything is app-driven.

```mermaid
sequenceDiagram
    participant DM
    participant P as Player (browser)
    participant S as Backend
    participant A as Tray app
    DM->>S: create invite (CLI or app)
    DM->>P: link https://host/join/CODE (or code / QR)
    P->>S: GET /api/invites/CODE → campaign name, consent version, download links
    P->>S: register (or login) + POST /campaigns/join
    P->>P: shown the download for their OS + the Connect step
    P->>A: install, then Open VTT Chat (deep link) or type the code into the app
    A->>S: redeems the code for its own session + WebSocket; campaign appears
    P->>S: logout (the browser session only existed to join and connect)
```

## Why a browser first

- A player who has not installed anything yet needs somewhere to land; the invite link _is_ that
  place, and it works from a phone (QR code at the table) even though the app is desktop-only.
- Account creation, the recording-consent notice and the download link are one page, not a
  chicken-and-egg inside an app they don't have.
- The app stays small: it has a Connect screen, never a sign-up or sign-in form.

## What the page may learn and do

- `GET /api/invites/:code` is public and rate-limited (shares the join endpoint's budget). It returns
  the campaign **name**, the instance's consent version and the configured download links — nothing
  else. A bad, expired or revoked code is the same `invite_invalid` as when joining.
- The page creates the account (or signs in to an existing one), joins, then offers the **Connect**
  step: _Open VTT Chat_ (a `vtt-chat://connect?server=…&code=…` link) and the code to type, with a countdown
  (5 minutes). There is no QR on this page: a phone has no app to open the deep link, and the app has no
  scanner. (The app's own Connect screen shows a QR, which a signed-in phone scans to approve at `/connect`.) The session is held in memory only and signed out when the page closes, so
  no token is left in the browser. The app never sees the password: it trades the one-time code for its own
  session. Design and rationale: [APP-SIGN-IN.md](APP-SIGN-IN.md).
- Consent wording lives in the page (`web/src/consts`); the server only checks the version string.

## Serving

`web/` is a Vite + React + Radix app (light/dark follows the OS). The backend serves `web/dist` at
`/join` and `/assets` when `WEB_DIR` is set (the Docker image and `install.sh` set it); a strict CSP
allows only the page's own script and styles. Without `WEB_DIR` the invite API still works.

| Variable                                   | Meaning                                         |
| ------------------------------------------ | ----------------------------------------------- |
| `WEB_DIR`                                  | built join page; unset = no browser pages       |
| `CLIENT_URL_WINDOWS` / `_MACOS` / `_LINUX` | download links shown on the page (all optional) |

## Open

- Deep links are unreliable on the Linux AppImage; there the typed code (or the app's own QR, approved from a
  signed-in phone) is the path. None of the three has been run on a real OS yet ([BUILD-STATUS.md](../BUILD-STATUS.md)).
- Password reset by magic link needs SMTP; without it the DM/operator issues a one-time code.

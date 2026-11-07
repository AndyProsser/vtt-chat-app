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
    P->>S: logout (the browser session only existed to join)
    P->>P: shown the download for their OS + instructions
    P->>A: install, open, sign in with the same email + password
    A->>S: session + WebSocket; campaign appears
```

## Why a browser first

- A player who has not installed anything yet needs somewhere to land; the invite link _is_ that
  place, and it works from a phone (QR code at the table) even though the app is desktop-only.
- Account creation, the recording-consent notice and the download link are one page, not a
  chicken-and-egg inside an app they don't have.
- The app stays small: it only needs a sign-in screen, never a sign-up flow.

## What the page may learn and do

- `GET /api/invites/:code` is public and rate-limited (shares the join endpoint's budget). It returns
  the campaign **name**, the instance's consent version and the configured download links — nothing
  else. A bad, expired or revoked code is the same `invite_invalid` as when joining.
- The page creates the account (or signs in to an existing one), joins, then **logs out**: no token
  is left in the browser. The app signs in for itself with the credentials.
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

- The app registers a `vtt-chat://connect?server=…` link so "Open the app" can pre-fill the server
  address. Registering the scheme is app work (Stage 4); until then the page also shows the address.
- Password reset by magic link needs SMTP; without it the DM/operator issues a one-time code.

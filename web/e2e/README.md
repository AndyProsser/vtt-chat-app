# Web UI smoke test (real browser)

`ui-smoke.mjs` drives the built web UI (Home, Download, Full app, Status, 404, the `/app` phone app) in headless
Chromium against a **local Compose smoke stack** and checks what unit tests cannot: real clicks, keyboard,
hover/touch, two browsers talking to each other, light and dark (`prefers-color-scheme`), 1000x800 desktop and
390x844 touch-mobile. It also collects page errors, console errors and failed or >= 400 requests per flow and takes
screenshots (look at them: the checks do not judge looks).

It is local tooling for the smoke stack only. It creates throwaway `@example.com` accounts and one campaign
(`UI Smoke Table`) through `vtt-admin` and the API, and never touches real tables (it only ever clicks the smoke
table's own card). **Do not point it at a server you care about.**

## Run

Needs: the smoke stack up at `https://localhost` (Caddy local CA), `/usr/bin/chromium`, the web build served by the
backend image (rebuild and restart the backend after web changes), and `puppeteer-core` installed **outside the repo**
(it is deliberately not in `package.json`):

```bash
mkdir -p ~/scratch/ui-tests && cd ~/scratch/ui-tests && npm init -y && npm i puppeteer-core

cd <repo>/web/e2e
export NODE_PATH=~/scratch/ui-tests/node_modules
export NODE_EXTRA_CA_CERTS=/path/to/caddy-root.crt   # never disable TLS verification in Node
export OUT=~/scratch/ui-shots                        # screenshots + a cached session per throwaway account
node ui-smoke.mjs                 # every flow (about 6 minutes)
node ui-smoke.mjs chat rail       # just some
```

Flows: `landing`, `download`, `chat` (commands, autocomplete, /late and RSVP), `rail` (members, presence, popouts),
`dmtools` (the DM writes, previews, shows, edits and deletes a note and schedules, edits and cancels a session while a player watches it live; every sheet is checked to fit at 320 to 1000px),
`account` (the /account page: profile, picture, password, devices and their sign-out; **written but not yet run**), `menu` (header, burger, widths), `loot` (the Loot tab: drop, see, take, put back), `join` (ask to join, withdraw, approve, decline, Allow join), `pages` (full-app,
status, 404, focus order, accessibility basics), `frame` (sign-in and table-picker header). Exit code is 1 when a
check fails. Env: `BASE` (default `https://localhost`), `CHROMIUM`, `COMPOSE_DIR` (default `../../infra/compose`).

## Things to know

- The join flow creates fresh accounts each run (a declined account cannot ask the same table again for days). They
  are harmless; remove them with the Admin CLI if the instance gets cluttered.
- Join requests are rate limited to 10 per hour per address; if a run hits 429, restart the backend container
  (the limiter is in memory) or wait.
- A flaky `net::ERR_NETWORK_CHANGED` from Chromium on a host whose network interfaces change (Docker) is not an app
  bug: re-run.
- Not covered: the new-account consent step (the CLI can only create accounts that already accepted), voice/LiveKit,
  the Tauri desktop app, and real touch hardware.

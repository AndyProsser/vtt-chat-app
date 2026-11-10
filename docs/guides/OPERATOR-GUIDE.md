# Operator guide

For the person who runs the server: one machine, your own, no cloud account needed. **Draft (2026-11-10).**
Steps marked **(not yet tried by someone else)** have only been run by the author.

- [1. What you are running](#1-what-you-are-running)
- [2. Before you start](#2-before-you-start)
- [3. Install with Docker Compose (recommended)](#3-install-with-docker-compose-recommended)
- [4. Install natively (advanced)](#4-install-natively-advanced)
- [5. First run](#5-first-run)
- [6. Turn on recording and AI summaries](#6-turn-on-recording-and-ai-summaries)
- [7. Configuration reference](#7-configuration-reference)
- [8. Day-to-day operation](#8-day-to-day-operation)
- [9. Back up and restore](#9-back-up-and-restore)
- [10. Update](#10-update)
- [11. Fix it](#11-fix-it)
- [12. Security checklist](#12-security-checklist)

## 1. What you are running

```mermaid
flowchart LR
  P[Player's app and browser] -- HTTPS / WSS --> C[Caddy: TLS]
  P -- UDP and TCP media --> L[LiveKit: voice]
  C --> B[Backend: accounts, chat, tables]
  B --> DB[(Postgres)]
  B --> V[(Valkey)]
  L --> V
  L -. recording .-> E[Egress]
  E --> F[(Recordings)]
  F --> W[Worker] --> AI[Whisper and an LLM]
  W --> DB
```

- **Backend**: sign-in, campaigns, chat, handouts, loot, scheduling, and the records pipeline's control.
- **LiveKit**: the voice rooms (one per campaign). **Egress** records each speaker to a file.
- **Worker + Whisper + an LLM**: turn a recording into a transcript and summaries, after the session.
- **Caddy**: HTTPS in front of everything. **Postgres** is the database; **Valkey** holds short-lived state.

Nothing here needs an outside account. Players' apps talk only to **your** server.

## 2. Before you start

- **A machine you control**: a VM or a spare PC with Ubuntu 24.04 (Docker Compose also works on other
  Linux). 4 GB of memory is enough for voice and chat. **Recording and AI summaries need more**: the
  speech-to-text and the language model are the heavy parts. Real sizing numbers are not measured yet
  (the model download alone is about 2 GB). Without a GPU, a session is transcribed in hours, not minutes,
  and that is by design (the work runs after the game).
- **A domain name** pointing at the machine (for example `vtt.example.com`). Browsers and the app
  need real HTTPS; Caddy gets the certificate for you from Let's Encrypt. To try things on one machine, use
  `localhost`.
- **Ports opened to the internet** (your router or cloud firewall; the installer never touches it):

  | Port                                   | What for                                     |
  | -------------------------------------- | -------------------------------------------- |
  | `80/tcp`, `443/tcp`, `443/udp`         | the website, the app's connection, sign-up   |
  | `7881/tcp`                             | voice over TCP when UDP is blocked           |
  | `50000-50200/udp` (a range you choose) | voice. **Required**; widen it for big groups |

  Behind a home router, forward those to the machine. **Cloudflare Tunnel cannot carry voice**; it can
  only front the web part. Players on very restrictive networks (hotel, school, some workplaces) may be
  unable to use UDP voice at all; LiveKit's built-in TURN is the fix and is off by default
  ([DEPLOYMENT-AND-TRANSPORT.md](../architecture/DEPLOYMENT-AND-TRANSPORT.md)).

- **Time to spend**: about half an hour for voice and chat, plus the model downloads if you add recording.

## 3. Install with Docker Compose (recommended)

```bash
sudo apt-get install -y docker.io docker-compose-v2 git   # or Docker's own packages
git clone https://github.com/AndyProsser/vtt-chat-app.git
cd vtt-chat-app/infra/compose
./setup.sh vtt.example.com                    # your domain; add your public IP as a second argument if behind NAT
docker compose up -d --build --wait
curl https://vtt.example.com/api/health       # {"ok":true,...}
```

What `setup.sh` does: writes `.env` and `livekit.yaml` with **fresh random secrets** (never printed, mode
600, never committed). Re-running it leaves them alone. `--force` regenerates them, which **signs everyone
out** and, because Postgres keeps the password it first started with, also means
`docker compose down -v`, **which deletes the database**. Do not use `--force` on a live server.

Check it worked:

```bash
./vtt-admin status          # database, Valkey and LiveKit should all say ok
```

Also open `https://vtt.example.com/status`: a public status page with the same checks, which is handy to
give your players.

**Behind NAT?** Pass your public IP: `./setup.sh vtt.example.com 203.0.113.7`, and forward the ports above.

**To try it on one machine first**: `./setup.sh localhost`. Caddy then uses its own certificate, so a
browser warns once; the desktop app may refuse it, so test the app against a real domain.

## 4. Install natively (advanced)

For people who do not want Docker. Ubuntu **24.04 LTS only** (it needs that release's `valkey-server`
and `caddy` packages).

```bash
git clone https://github.com/AndyProsser/vtt-chat-app.git && cd vtt-chat-app
sudo infra/install.sh --domain vtt.example.com [--public-ip 203.0.113.7] [--with-records]
```

It installs Postgres, Valkey and Caddy from apt, Node.js and LiveKit as checksum-verified downloads,
builds the backend, writes secrets to `/etc/vtt/vtt.env` (mode 640, never printed), and creates hardened
systemd units: `vtt-backend`, `vtt-livekit` (and `vtt-whisper`, `vtt-ollama`, `vtt-worker` with
`--with-records`). Re-running is safe and keeps your secrets and data. `--dry-run` shows the plan;
`--no-start` installs without starting.

Two limits to know: it **does not install LiveKit Egress** (the recorder ships only as a container), so
native recording needs the Compose `egress` service next to it; and it does **not open ports** for you.
LXC containers are possible but unsupported ([DEPLOYMENT-AND-TRANSPORT.md](../architecture/DEPLOYMENT-AND-TRANSPORT.md)).

## 5. First run

1. **Create the first account: it becomes the Admin.** The app has no sign-up screen (accounts are made on
   the browser join page from an invite), so the very first account is made on the server:

   ```bash
   ./vtt-admin user create you@example.com --name "Your Name" --accept-consent
   ./vtt-admin user code you@example.com signin      # a one-time code
   ```

   Then open the desktop app, choose your server, and sign in with that code (Profile → sign in with a
   code). Set a password afterwards if you want one. `--accept-consent` records that the person has agreed to the recording notice (for the first account, that is
   you). The first account is the Admin; add `--admin` to make a later one an Admin too. **(`user create` is new,
   2026-11-10, and has not yet been tried by someone else.)**

2. **Decide who may create campaigns:** `./vtt-admin settings set campaign-creation closed` (only Admins) or
   `open` (any signed-in player). Default is set when the instance is created; `settings show` lists it.
3. **Give players a download.** The join page shows download links for Windows, macOS and Linux if you set
   `CLIENT_URL_WINDOWS`, `CLIENT_URL_MACOS`, `CLIENT_URL_LINUX` in `.env` (any of them). Build the installers
   with `npx tauri build` on each OS ([CLIENT-UPDATES.md](../architecture/CLIENT-UPDATES.md)) and host them
   anywhere (a release page, the server itself).
4. **Invite a table.** In the app, the DM creates an invite (an emailed link, a code, or a QR code). Anyone
   with the code joins; invites expire (default set by `invite-expiry-days`) and can be used by the whole
   group. See [JOIN-FLOW.md](../architecture/JOIN-FLOW.md).
5. **No email server?** That is fine. When someone forgets a password or needs a first sign-in code:
   `./vtt-admin user code them@example.com signin` (or `reset`). The code is valid for a short time;
   pass it on by chat or phone.

Sign-in options (password, emailed code, single sign-on) are in [SIGN-IN-OPTIONS.md](../architecture/SIGN-IN-OPTIONS.md).

## 6. Turn on recording and AI summaries

Recording is a **profile** you add to the same stack:

```bash
cd infra/compose
docker compose --profile records up -d --wait
```

This adds **Egress** (about 4 GB of image), **Whisper** (speech to text; about 190 MB model),
**Ollama** (a language model, about 2 GB for the default `llama3.2:3b`) and the **worker** that runs the
jobs. The first start downloads the models; give it time (`docker compose logs -f models-init ollama-pull`).

How it behaves, so you can explain it to your players:

- The **DM** starts, pauses, resumes and stops a recording in the app. Every player's app plays a clear
  "recording" cue, and **a player's voice is only recorded after their app has played it**.
- Each speaker is recorded separately. Whispers and private lines are **never** recorded or transcribed.
- Lines typed into the public chat during a recording go into the transcript, marked "(typed)".
- Sound effects from the DM's soundboard are **not** recorded (unless you switch on `RECORD_SOUNDBOARD=1`, for
  testing: they are then saved as a separate, never-transcribed file).
- If the DM's app disconnects, the recording carries on. After `RECORDING_GRACE_SECONDS` (default 30)
  any player can pause, resume or stop it. If **everyone** is gone for that long, it stops by itself.
  The DM cannot switch campaigns or hand over the DM role while a recording runs. Details:
  [RECORDING-AND-SUMMARIES.md](../architecture/RECORDING-AND-SUMMARIES.md#while-a-recording-runs-decided-2026-11-10).

**Where the AI runs** is your choice. By default everything runs on your server (slow on a CPU, nothing
leaves the machine). To send transcription or summaries to a stronger machine you own (for example a gaming
PC with a GPU) use `vtt-admin settings keys` to see the `ai.*` settings; jobs wait for that machine and
fall back to the local CPU after a time you set. A **cloud** AI service is possible but means session audio
or text leaves your server: it needs an explicit setting, and the app tells players.

## 7. Configuration reference

Everything is set by environment variables: in `infra/compose/.env` for Compose, or `/etc/vtt/vtt.env`
natively. Restart the backend after changing them (`docker compose up -d`, or
`sudo systemctl restart vtt-backend`).

| Variable                                                                  | Default                  | What it does                                                                                                                            |
| ------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_ADDRESS`                                                            | (set by `setup.sh`)      | The domain players use                                                                                                                  |
| `PUBLIC_URL`                                                              |                          | The address used in links the server sends (emails, invites)                                                                            |
| `DATABASE_URL`, `VALKEY_URL`                                              | (set for you)            | Postgres and Valkey connections                                                                                                         |
| `LIVEKIT_URL`, `LIVEKIT_API_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | (set for you)            | How the backend talks to LiveKit                                                                                                        |
| `RECORDINGS_DIR`                                                          | (set in records profile) | Where Egress writes audio; setting it turns recording on                                                                                |
| `RECORDING_GRACE_SECONDS`                                                 | 30                       | Seconds the DM may be disconnected before players can step in; also the time with nobody connected before a recording stops (5 to 3600) |
| `RECORD_SOUNDBOARD`                                                       | off                      | `1`: also save the DM's sound effects as a separate file (testing only)                                                                 |
| `MEDIA_DIR`                                                               | (set for you)            | Where handouts, pictures and sound clips are stored. Needs disk space                                                                   |
| `SMTP_URL`, `MAIL_FROM`                                                   | off                      | Send sign-in codes by email (optional; the CLI can hand out codes without it)                                                           |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`                     | off                      | Sign in through your own identity provider (Authelia and similar)                                                                       |
| `DDB_SYNC`, `DDB_SYNC_HOURS`                                              | off, 12                  | `1`: keep linked D&D Beyond characters fresh (contacts dndbeyond.com)                                                                   |
| `CLIENT_URL_WINDOWS` / `_MACOS` / `_LINUX`                                | none                     | Download links on the join page                                                                                                         |
| `UPDATES_DIR`                                                             | (set for you)            | Where signed app updates are published                                                                                                  |
| `WEB_DIR`, `STATUS_DIR`                                                   | (set for you)            | The join page and the status page                                                                                                       |
| `PORT`                                                                    | 3000                     | The backend's port (loopback only in Compose)                                                                                           |

Runtime settings (no restart) live in the database: `./vtt-admin settings show`.

## 8. Day-to-day operation

**The admin command** (`./vtt-admin` in `infra/compose`; natively `node backend/dist/cli/main.js`):

| Command                                                       | Use                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `status`                                                      | Is everything up? Exits 1 if not (good for monitoring)                       |
| `settings show` / `keys` / `set <key> <value>`                | Campaign creation, offline limit, invite expiry, AI backends                 |
| `user list`, `user admin <email> grant\|revoke`               | See accounts; make or remove an Admin                                        |
| `user code <email> [signin\|reset]`                           | One-time code for someone locked out                                         |
| `user revoke-sessions <email>`                                | Sign a person out everywhere (lost laptop)                                   |
| `jobs list [state]`, `jobs retry <id>`                        | Look at the summary queue; retry a failed job                                |
| `recording list`, `recording reprocess <id> [--retranscribe]` | Redo a recording's summaries (or transcript) from the kept audio             |
| `recording purge <id>` or `--older-than <days>`               | Delete the raw audio of processed recordings (transcript and summaries stay) |
| `updates publish …`, `updates status`                         | Publish an app update; see what players are offered                          |

**Logs:** Compose: `docker compose logs -f backend` (also `livekit`, `egress`, `worker`, `caddy`).
Native: `journalctl -u vtt-backend -f` (also `vtt-livekit`, `vtt-worker`, `caddy`).

**Watching it:** `https://your-domain/status` shows backend, database, LiveKit and the records queue,
the number of connected players and whether a recording is active. It is public and shows nothing private.

**Disk:** recordings and uploads grow, and the raw audio is by far the biggest part. Set
`RECORDING_RETENTION_DAYS` (for example `60`) in `.env` and the worker deletes the audio of processed
recordings that old, keeping the transcript and summaries; or do it yourself with
`./vtt-admin recording purge --older-than 60`. `./vtt-admin recording list` shows which recordings still have
their audio. There is no disk-usage figure in the tools yet: use `df -h`, and `du -sh` on the recordings volume
(Compose: `docker system df -v`; native: `/var/lib/vtt/recordings`). Do not purge a recording you may want to
**re-transcribe** with a better model: once the audio is gone only the summaries can be redone.

**Health you can rely on:** the app reconnects itself after network loss, sleep or a server restart. A
recording survives the DM's app crashing (see section 6). A **server** restart during a recording marks
that recording interrupted; the audio already written is kept and can be reprocessed.

## 9. Back up and restore

**Compose** has two scripts (`infra/compose`):

```bash
./backup.sh                  # database + uploaded files + your .env and livekit.yaml, into ./backups/vtt-backup-<date>
./backup.sh --audio          # also the recorded audio (large; the transcripts are in the database anyway)
./backup.sh --to /mnt/usb    # somewhere else
```

Each run makes one folder (mode 700) with `database.sql.gz`, `media.tar.gz`, `config/` (the **secrets**) and a
`MANIFEST.txt`. **Copy it off the machine** (another disk, another computer): a backup on the same disk
does not survive that disk. Do it on a schedule, for example a weekly cron job:
`0 4 * * 0  cd /path/to/vtt-chat-app/infra/compose && ./backup.sh --to /mnt/backups`.

**To restore** (on a fresh install, or to go back in time):

```bash
./restore.sh ./backups/vtt-backup-20261110-040000 --yes             # replaces the database and uploads here
./restore.sh <folder> --yes --with-config                           # on a brand-new machine: also the saved .env and livekit.yaml
./vtt-admin status
```

`restore.sh` stops the backend, replaces the database and the uploaded files, then starts everything. It
refuses without `--yes`. A restore needs the **same secrets** the data was made with: the saved `.env` holds
the database password and the keys that sign players in, which is why `--with-config` exists. On a
machine that already runs, **take a fresh backup first**.

Tested 2026-11-10 against a real Postgres and volume: data and uploaded files deleted, restored, and
compared. **Not tested:** a full restore onto a brand-new machine through to players reconnecting, and the
`--audio` path on real recordings. Rehearse on a spare machine once.

**Native install** has no script yet; do it by hand: `sudo -u postgres pg_dump vtt | gzip > vtt.sql.gz`
(the database and its user are both `vtt`), copy `/var/lib/vtt/media` (and `/var/lib/vtt/recordings` if
you keep audio), and `/etc/vtt/vtt.env`. Restore by loading the dump into an empty `vtt` database and
putting the files and `vtt.env` back.

Keep Postgres on local or block storage, **never on NFS** (file locking over NFS can corrupt a database).

## 10. Update

```bash
cd vtt-chat-app && git pull
cd infra/compose && docker compose up -d --build --wait     # add --profile records if you use it
./vtt-admin status
```

The backend applies database changes (migrations) when it starts; they only move forward, so **take a
backup first** and do not roll the code back to an older version afterwards. Natively: `git pull`, then
`sudo infra/install.sh --domain …` again (it is safe to re-run).

**Updating players' apps:** build signed installers, then `vtt-admin updates publish <folder> --version
X.Y.Z --base-url https://your-domain/updates --notes "…"`. Players see a banner ("Version X.Y.Z is
ready") and update when they click; the app never restarts by itself mid-game. Keep the signing key
(`~/.tauri/vtt-chat-updater.key`) safe and backed up: if it is lost, installed apps can never update again
([CLIENT-UPDATES.md](../architecture/CLIENT-UPDATES.md)).

## 11. Fix it

| Symptom                                              | Likely cause and what to do                                                                                                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Players can sign in and chat but **no voice**        | UDP is blocked. Check the port range is forwarded to the **server** (not just open), `7881/tcp` too, and `use_external_ip`/public IP in `livekit.yaml` if behind NAT. `./vtt-admin status` shows LiveKit |
| Voice works for some players, not on one network     | That network blocks UDP (school, hotel, work). Try another network; the lasting fix is LiveKit's TURN                                                                                                    |
| Green padlock missing / certificate error            | The domain does not point at the server yet, or ports 80/443 are closed (Caddy cannot get a certificate). `docker compose logs caddy`                                                                    |
| `./vtt-admin status` says Postgres is down           | `docker compose ps`; `docker compose logs postgres`. After `setup.sh --force` the password no longer matches the old database volume (see section 3)                                                     |
| A player cannot sign in and email is not set up      | `./vtt-admin user code <email> signin` and give them the code                                                                                                                                            |
| Locked out as Admin                                  | Another Admin can run `user admin <you> grant`; with none, `user code <your email> signin` from the server                                                                                               |
| Recording button does nothing / no audio files       | The records profile is not running (`docker compose --profile records ps`), or `RECORDINGS_DIR` is unset. A player's voice is only recorded after their app played the start cue                         |
| Summaries never appear                               | `./vtt-admin jobs list failed`; read the worker's log (`docker compose logs worker`); `jobs retry <id>`. The first run is slow on a CPU. A remote AI that is off waits, then falls back to local         |
| Disk full                                            | Old recordings and uploads. Move or delete files in the recordings/media volumes; there is no auto-purge yet                                                                                             |
| After an update the app says it needs a newer server | Update the server first (section 10), then the apps                                                                                                                                                      |
| Everything is slow after a long uptime               | `docker stats`; restart one service at a time (`docker compose restart backend`). Players reconnect on their own                                                                                         |

When you report a problem, include `./vtt-admin status`, the relevant log lines, and what the player saw.

## 12. Security checklist

- Keep `.env`, `livekit.yaml` and `/etc/vtt/vtt.env` private; they are the keys to your server. Do not
  paste them into chat or issues.
- Open only the ports in section 2. Postgres and Valkey stay on the machine.
- Keep the machine updated (`apt upgrade`) and update this software when new versions come out.
- Back up before updating; test a restore once.
- Players are asked to consent to being recorded when they join; if you change the consent text, bump
  `consent-version` and everyone is asked again.
- Anything that sends session audio or text off your server (a cloud AI, D&D Beyond sync) is **off**
  until you turn it on, and the app says so where it applies.

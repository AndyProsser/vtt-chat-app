# Docker Compose deployment (primary)

The recommended way to run an instance: one VM or server, Docker + Compose, nothing else installed.
Rationale and the other tiers (native, LXC): [DEPLOYMENT-AND-TRANSPORT.md](../../docs/architecture/DEPLOYMENT-AND-TRANSPORT.md).

```bash
cd infra/compose
./setup.sh vtt.example.com            # or: ./setup.sh localhost   to try it on one machine
docker compose pull                   # the published images for this release line (see below)
docker compose up -d --wait
curl -k https://vtt.example.com/api/health      # {"status":"ok"}
```

If a port is taken, `setup.sh` warns (80, 443, 7880, 7881) or picks a free one (Valkey's and the backend's loopback ports).

**Images.** Each release tag publishes `ghcr.io/andyprosser/vtt-chat-backend` and `vtt-chat-worker` (CI: `.github/workflows/images.yml`).
`setup.sh` pins `VTT_VERSION` in `.env` and prints it. On a checkout of a release tag it is the release line (`0.4`), so
`docker compose pull` takes the newest **patch** of that line and never a new minor: a new minor changes the client/server protocol
and is a deliberate upgrade of the whole stack ([versioning rules](../../docs/architecture/VERSIONING-AND-DEPLOYMENT.md)). When the
newest tag is a **dev build** it is that exact version (`0.4.0-dev.5`), because dev tags publish only their own tag. Override with
`VTT_VERSION=0.4.0-dev.4 ./setup.sh <site>` or by editing `.env`; pin an exact version (`0.3.2`) to hold still.
To build from this checkout instead (development, or an unreleased commit): `docker compose up -d --build`.
Dev builds (`v0.4.0-dev.N`) publish only their exact tag. If the pull is refused, the GitHub package is still private: the owner
sets it to public once under the repository's Packages settings.

`setup.sh` writes `.env` and `livekit.yaml` (mode 600, git-ignored) with fresh random secrets and never prints them. Re-running leaves them alone; `--force` regenerates — and because Postgres keeps the password it first started with, that also means `docker compose down -v` (which **deletes the database**).

## What runs

| Service    | Image                           | Notes                                                                                                                                |
| ---------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `caddy`    | `caddy:2-alpine`                | TLS (Let's Encrypt for a real domain; internal CA for `localhost`). `/api`, `/ws` → backend; `/livekit/*` → LiveKit signalling       |
| `backend`  | built from `backend.Dockerfile` | Runs migrations on start. Production deps only, non-root                                                                             |
| `postgres` | `postgres:17-alpine`            | Named volume. Never on NFS                                                                                                           |
| `valkey`   | `valkey/valkey:8-alpine`        | Replay buffer; also LiveKit's Redis. Published on loopback only (`VALKEY_HOST_PORT`, default 6379) because LiveKit is host-networked |
| `livekit`  | `livekit/livekit-server`        | **`network_mode: host`** on purpose: a NATed UDP port range is slow to start and advertises wrong ICE addresses                      |

**Records profile** (`docker compose --profile records up -d`): adds

- `egress` — LiveKit Egress, host-networked (~3.8 GB image); per-speaker files land in the `recordings` volume;
- `whisper` (whisper.cpp server, OpenAI-compatible, CPU, model fetched once by `models-init`; `WHISPER_MODEL_FILE` picks it, default `ggml-small-q5_1.bin`) and `ollama` (model pulled by `ollama-pull`; `OLLAMA_MODEL`, default `llama3.2:3b`) — the **local AI that is always configured** and is the fallback for a remote backend;
- `worker` — claims `process-recording` jobs, cuts tracks into speech windows, calls Whisper and the LLM as the operator's AI settings say.

**NVIDIA GPU:** add `compose.gpu.yml` (`COMPOSE_FILE=compose.yml:compose.gpu.yml` in `.env`, then `up -d --build`): Whisper is built from `whisper-cuda.Dockerfile` (works on GTX 10-series; ~30 min once) and runs behind `whisper-idle.py`, which frees its VRAM after 60 s idle; Ollama runs on the card and unloads after `OLLAMA_KEEP_ALIVE` (2m). GPU defaults: `large-v3-turbo` and `qwen3:8b`; CPU defaults: `small` q5_1 and `llama3.2:3b` (measured: [RECORDING-AND-SUMMARIES.md](../../docs/architecture/RECORDING-AND-SUMMARIES.md#verified-on-the-compose-stack-2026-11-12)). **Smoke test after an install:** `node infra/records-smoke/compose-e2e.ts` ([how](../records-smoke/README.md#the-compose-end-to-end-test-compose-e2ets-run-it-after-an-install)).

First start downloads ~190 MB (Whisper) and ~2 GB (the LLM); with the GPU override ~574 MB and ~5.2 GB. **The loop is closed:** when the DM starts a recording, the backend starts an Egress file for each player's track **after that player's app has acknowledged the start cue**, collects the files into `recording_tracks` on stop, and queues the processing job — no manual step (`RECORDINGS_DIR=/out` is set for the backend). `./vtt-admin recording reprocess <id>` redoes a recording from the kept audio.

## Admin

`./vtt-admin status` (database, Valkey, LiveKit), `./vtt-admin settings …`, `./vtt-admin user …` — see [backend/README.md](../../backend/README.md#admin-cli-vtt-admin). The first account to register is the Admin.

## Backup and restore

`./backup.sh [--audio] [--to <folder>]` writes one folder with the database, the uploaded files and your `.env` and `livekit.yaml` (secrets, mode 700: keep it off this machine); `./restore.sh <folder> --yes [--with-config]` puts it back, replacing what is there. Details and the native-install equivalent: [the operator guide](../../docs/guides/OPERATOR-GUIDE.md#9-back-up-and-restore).

## Ports to open

`80/tcp`, `443/tcp+udp`, `7881/tcp` (ICE-over-TCP fallback), and the UDP range in `livekit.yaml` (default `50000-50200/udp`). Behind NAT, run `./setup.sh <site> <public-ip>` so LiveKit advertises the public address.

## Verified

2026-11-07, dev PC (Docker 29): stack healthy; migrations applied; register → login → campaign → invite → join over the loopback port; Caddy served `/api/health` and `/livekit/` over its internal TLS; two `rust-livekit` clients joined one room on the containerised LiveKit and saw each other. **Records (2026-11-07):** the DM starts a recording → players' apps acknowledge the cue → Egress per-speaker files → DM stops → tracks registered and job queued by the backend → the `worker` container → Whisper and Ollama containers → transcript segments (correct offsets, silence skipped) and the two summaries (`members` and `dm` visibility) in Postgres, `processed`. **2026-11-12, the records profile on this stack, GPU override:** `compose-e2e.ts` passed end to end (four synthetic speakers over `wss://` through Caddy, consent acks, late joiner, pause, second recording, worker killed mid-job, remote-AI fallback). **Not yet verified:** audio actually heard by people, a public-domain Let's Encrypt certificate, and a fresh-VM install by someone other than Andy (the Stage 3 done-when).

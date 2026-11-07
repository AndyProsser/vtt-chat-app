# Docker Compose deployment (primary)

The recommended way to run an instance: one VM or server, Docker + Compose, nothing else installed.
Rationale and the other tiers (native, LXC): [DEPLOYMENT-AND-TRANSPORT.md](../../docs/architecture/DEPLOYMENT-AND-TRANSPORT.md).

```bash
cd infra/compose
./setup.sh vtt.example.com            # or: ./setup.sh localhost   to try it on one machine
docker compose up -d --build --wait
curl -k https://vtt.example.com/api/health
```

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

First start downloads ~190 MB (Whisper) and ~2 GB (the LLM). **Not yet linked:** nothing creates the `recordings`/`recording_tracks` rows when Egress finishes; today a recording is registered by hand (see Verified) and processed with `./vtt-admin recording reprocess <id>`.

## Admin

`./vtt-admin status` (database, Valkey, LiveKit), `./vtt-admin settings …`, `./vtt-admin user …` — see [backend/README.md](../../backend/README.md#admin-cli-vtt-admin). The first account to register is the Admin.

## Ports to open

`80/tcp`, `443/tcp+udp`, `7881/tcp` (ICE-over-TCP fallback), and the UDP range in `livekit.yaml` (default `50000-50200/udp`). Behind NAT, run `./setup.sh <site> <public-ip>` so LiveKit advertises the public address.

## Verified

2026-11-07, dev PC (Docker 29): stack healthy; migrations applied; register → login → campaign → invite → join over the loopback port; Caddy served `/api/health` and `/livekit/` over its internal TLS; two `rust-livekit` clients joined one room on the containerised LiveKit and saw each other. **Records (2026-11-07):** LiveKit room → Egress per-speaker files → `vtt-admin recording reprocess` → the `worker` container → Whisper and Ollama containers → transcript segments (correct offsets, silence skipped) and the two summaries (`members` and `dm` visibility) in Postgres, `processed`. **Not yet verified:** audio actually heard, the SDK's `wss://` signalling through Caddy, a public-domain Let's Encrypt certificate, and a fresh-VM install by someone other than Andy (the Stage 3 done-when).

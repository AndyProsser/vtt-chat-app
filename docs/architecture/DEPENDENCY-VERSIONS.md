# Service versions: what we pin, what is current, what to do

A review of the third-party services the Docker Compose stack runs (Postgres, Valkey, LiveKit and its Egress, Whisper, Ollama, and the smaller ones), made 2026-11-21 at Andy's request, for **security, performance and support**. It records where each pin stands against the project's own current release and support dates, so the next review starts from facts. Versions were read from each project's releases (GitHub, postgresql.org, valkey.io) and from the running VM and dev stack on the same day.

**Nothing was changed by this review.** The recommendations are for Andy to choose from; each bump is tested with the demo campaign ([QUALITY-VALIDATION.md](QUALITY-VALIDATION.md)) before it ships.

## The short version

| Service            | We pin                                                                                             | Running (VM)                  | Current                                                                        | Supported until                                             | Verdict                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Postgres**       | `postgres:17-alpine` (floats within 17)                                                            | 17.12                         | 17.12 is the latest 17; **18.7** is the mature major; 19.0 came out 2026-11-19 | 17: **Nov 2029**; 18: Nov 2030; 19: Nov 2031                | **Fine now.** Patched and three years of support left. Plan 18 deliberately (needs a dump and restore, and a different volume path); do not take 19.0 |
| **Valkey**         | `valkey/valkey:8-alpine` (floats within 8)                                                         | 8.1.12 (the dev stack 8.1.11) | **9.2.0** (GA 2026-11-18); 9.1.4; 9.0.8; 8.1.12                                | 8.1: maintenance Mar 2028, security Mar 2030; 9.1: May 2029 | **Update now.** 18 Nov 2026 was a **security** release on every branch. Pin the exact patch; consider 9.1 with 0.7.0                                  |
| **LiveKit server** | `v1.13.5`                                                                                          | 1.13.5                        | **v1.13.11** (2026-10-25)                                                      | Latest line only                                            | **Bump to v1.13.11.** Six patch releases of deadlock, goroutine-leak, nil-pointer and reconnect fixes                                                 |
| **LiveKit Egress** | `v1.15.0`                                                                                          | v1.15.0                       | **v1.15.0** (2026-10-06)                                                       | Latest line only                                            | **Current.** That release closed two Chrome remote-code-execution bugs (we do not use Chrome)                                                         |
| **whisper.cpp**    | CPU: image digest of a `main` build (2026-11-14); no-AVX: builds **v1.9.5**; CUDA: builds `master` | compat image, v1.9.5          | **v1.9.5** (2026-10-06)                                                        | Rolling                                                     | **Current for the tagged builds.** Pin the CUDA build's ref                                                                                           |
| **Ollama**         | `0.40.16`                                                                                          | 0.40.16                       | **0.40.17** (2026-11-10)                                                       | Rolling                                                     | **Current within one patch.** Bump with the next change; no security items in its notes                                                               |
| cloudflared        | `2026.11.0`                                                                                        | (optional)                    | 2026.11.1                                                                      | Rolling                                                     | Bump with the next change                                                                                                                             |
| Caddy              | `caddy:2` (floats)                                                                                 | v2.11.9                       | v2.11.9                                                                        | Rolling                                                     | Current; floating is acceptable (see below)                                                                                                           |

## Each one

### Postgres: 17.12, current for 17

The version running (17.12) is the newest 17 release, so there is nothing to patch. PostgreSQL supports a major version for five years: **17 until November 2029**, 18 until November 2030, 19 (released 2026-11-19) until November 2031 ([versioning policy](https://www.postgresql.org/support/versioning/)). Moving to 18 gains newer performance features but is a **major upgrade**, and one Docker detail bites: from 18 the official image keeps its data in a version-specific directory (`/var/lib/postgresql/18/docker`) and its volume is `/var/lib/postgresql`, not `/var/lib/postgresql/data`. Changing only the image tag points the server at an empty directory or fails at start ([image notes](https://hub.docker.com/_/postgres); [a worked 17 to 18 upgrade](https://www.virendrachandak.com/techtalk/postgresql-18-docker-upgrade-dump-and-restore-method/)). The supported way for our scale is **dump and restore into a new volume**, which our `vtt-admin backup` / `restore` already do (the database part works; the uploads part was fixed 2026-11-21). **Do not adopt 19.0**: a x.0 of a new major is not a production choice; revisit around 19.2.

- **Recommended:** stay on 17 for now. Move to **18** as a planned step (the 0.7.0 window is a natural time), with the volume path changed, the backup tested first, and the demo campaign run on it.
- **Native installs** take PostgreSQL from Ubuntu's packages, so Ubuntu's security updates (`apt`) are what matters there, not our pin.

### Valkey: update now (security release)

[Valkey 8.1.12](https://github.com/valkey-io/valkey/releases/tag/8.1.12) (2026-11-18) is marked **"Upgrade urgency SECURITY"**: CVE-2026-130822, a use-after-free crash in client eviction **when `maxmemory-clients` is enabled**. **We do not enable it** (Valkey runs with defaults in `compose.yml`), so we are not exposed by that bug, but the same release carries a long list of crash and memory fixes (Lua, HyperLogLog, `SORT`, module and cluster paths), all released the same day across 8.0, 8.1, 9.0, 9.1 and 9.2. The VM already runs 8.1.12; the dev stack runs 8.1.11 because a floating tag only updates when someone pulls.

Support ([Valkey's policy](https://valkey.io/topics/releases/)): each minor gets three years of patches from its first release, and the last minor of a major gets five years of security fixes. **8.1** is maintained to March 2028 (security to March 2030) and is the last 8.x; **9.0** to October 2028; **9.1** (released 2026-05-19) to May 2029; **9.2.0** went GA on 2026-11-18, too new to adopt yet. We use Valkey lightly (the live-chat replay buffer, and LiveKit's own signalling bus), so a major move buys little speed, but staying on a major that is two behind means the "last 8.x" is the line that will be dropped first.

- **Recommended now:** pin **`valkey/valkey:8.1.12-alpine`** (an exact patch), so everyone gets the fix when they pull and a new patch is a deliberate bump, and pull on the dev stack.
- **Recommended with 0.7.0:** move to **9.1.x** after running LiveKit and the demo campaign on it.

### LiveKit server: bump to v1.13.11

We pin v1.13.5; the latest is **v1.13.11** ([releases](https://github.com/livekit/livekit/releases)). The six patches in between are fixes, none flagged as security: a connection-drain deadlock, a data-track subscription deadlock, a goroutine leak in the RPC layer, a nil-pointer crash, reconnect messages held until the response goes out, and a cap on retransmissions per down-track (a performance guard for bad networks). For a server that sits in every session and is expected to run for hours, those are the changes that matter. It is the same minor line, so the risk is low. The native installer pins the same version (`infra/install.sh`).

- **Recommended:** bump the Compose pin and `install.sh` to **1.13.11**, then run the demo campaign (voice, recording, the Egress track capture).

### LiveKit Egress: already current

v1.15.0 is the latest. Its security notes (two Chrome V8 remote-code-execution bugs, an S3 role setting, gRPC and OpenTelemetry updates) mostly concern composite and web egress; we record per-speaker audio tracks and do not use Chrome. Keep it current, and check the server and Egress versions are a tested pair when either moves.

### Whisper (whisper.cpp)

The three images are not equally pinned:

- the **CPU** image is a digest of an upstream `main` build from 2026-11-14 (upstream publishes `main` builds, not release tags, so the digest is the only honest pin);
- the **no-AVX** (compat) image builds **v1.9.5**, the latest release (2026-10-06, a ggml 0.26.0 sync);
- the **CUDA** image builds **`master`** at whatever commit is current when it is built (`WHISPER_REF=master`), so two builds can differ silently.

- **Recommended:** pin `WHISPER_REF` in `whisper-cuda.Dockerfile` to `v1.9.5`, and move the CPU image to a digest recorded with its date when it is bumped.
- **Keep CUDA 12.x** (the Dockerfile uses 12.4.1): Andy's GTX 1080 is a Pascal card, and CUDA 13 dropped Pascal. A newer CUDA base would strand older GPUs, which the project's "old hardware" users rely on.

### Ollama: one patch behind

Pinned 0.40.16, latest 0.40.17 (2026-11-10, which adds a model and a Claude Code integration; nothing for us). No release since 0.40.0 mentions a security fix in its notes. Bump when convenient. The **models** are a separate choice from the server version (the summary model is `qwen3.5:4b` on CPU and `qwen3:8b` on a GPU) and are reviewed with the prompt work in Stage 13.

### The smaller ones

- **cloudflared** 2026.11.0 → 2026.11.1: bump with the next change (only used behind Cloudflare).
- **Caddy** floats on `caddy:2` and is v2.11.9, the latest; the floating major is fine because Caddy keeps 2.x compatible and is rebuilt into our own image at each release.
- **Node** `node:26-alpine` in our images floats within the current line; rebuilt at each release.

## How a bump is tested

A version bump ships only after the **demo campaign** has run on it (voice, recording, all three sessions processed, the report with no new errors, memory and the CPU and memory numbers compared with the last run). That is exactly what Stage 13 builds, so each of the changes above is cheap to prove.

## Suggested order

1. **Now (patch level, low risk):** LiveKit server 1.13.5 → 1.13.11; Valkey pinned to 8.1.12; Ollama 0.40.17; cloudflared 2026.11.1; the CUDA build's whisper ref pinned. Then update the dev stack and the VM and re-run the demo campaign.
2. **With 0.7.0 (planned):** Valkey 9.1; Postgres 18 with the volume change; re-measure.
3. **Not yet:** Postgres 19, Valkey 9.2 (both brand new), CUDA 13 (drops Pascal).

## Sources

- PostgreSQL versioning policy: <https://www.postgresql.org/support/versioning/>
- Postgres Docker image and the 18 data-directory change: <https://hub.docker.com/_/postgres>
- Valkey releases and support policy: <https://valkey.io/topics/releases/>, <https://github.com/valkey-io/valkey/releases/tag/8.1.12>
- LiveKit, Egress, whisper.cpp, Ollama, cloudflared and Caddy release notes: their GitHub releases pages.

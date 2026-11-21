# Stage 9: cross-platform hardening and production readiness

> **Moved from [ROADMAP.md](../../ROADMAP.md) on 2026-11-21, kept as written.** Closed for building 2026-11-18. The roadmap keeps a one-line summary of this stage; this file is the detail: the design, the decisions and who made them, and the build record. What has really run is in [BUILD-STATUS.md](../BUILD-STATUS.md). Index: [README.md](README.md).

## Stage 9 — Cross-Platform Hardening & Production Readiness

**Status:** 🟢 **Closed for building, 2026-11-18** (Andy). Started 2026-11-16 on the `stage-9-hardening` branch; its first part shipped in **0.5.2** and the rest in **0.5.3**. What is built is listed below. **What still needs real hardware or real people moved to [Stage 11](STAGE-11-PROTOCOL-4.md#stage-11--protocol-4-and-verification-060-and-061-planned-2026-11-18)**, so a bug found there is a bug, not an open stage.
**Depends on:** Stage 5 (can overlap Stages 6–8)

**Deliverables:**

- Verified audio parity on Windows, Linux (GNOME + KDE) and, if a player appears, macOS
- Tray behaviour documented per desktop (GNOME AppIndicator, Wayland limits) with graceful degradation
- Real 8+ hour soak with churn, memory profiled against the Stage 0.5 rules
- A real server-restart-mid-recording drill: recording recovers or fails loudly, never silently — **built and drilled 2026-11-10** (`infra/records-smoke/restart-drill.sh`; recovery stops the leftover egresses and keeps the audio; see [RECORDING-AND-SUMMARIES.md](../architecture/RECORDING-AND-SUMMARIES.md)); a `kill -9` of the packaged backend is still to try
- Security pass: consent-cue bypass attempts, private-audio leakage into records, token/session expiry, ACL checks on every records endpoint — **done 2026-11-10** for the REST surface and live sockets (access matrix; found and fixed a player who left still receiving chat and voice); the Egress capture and whisper paths were already covered by tests
- Packaging: installers per OS, signed where practical, updater verified
- **Records that a CPU-only server can keep up with, and that people want to read** — **built 2026-11-16 and 17** for 0.5.2.
  Whisper works only on the part of each clip that holds sound, and the no-AVX image uses OpenBLAS (a 2010 Xeon: 19.3×
  the audio's length down to 1.68×). Summaries are two passes, a scribe's notes then a bard's tale, with the notes taken
  once per stretch of recording (about a quarter of the model time on a long session). New CPU defaults: `small.en` and
  `qwen3.5:4b`. Players read the tales; the DM also has a key-points brief and the scribe's notes behind a toggle; the
  transcript is DM-only at the API and shown by the desktop app only with dev builds on. End-to-end test 49/49 on the dev
  PC (GPU). **Not yet run:** a real session on the VM's CPU defaults, and a transcript long enough to need several
  pieces of notes. Design: [RECORDING-AND-SUMMARIES.md](../architecture/RECORDING-AND-SUMMARIES.md).
- **Container hardening** — **built 2026-11-17** for 0.5.2, running on the test VM: every Compose service drops all
  capabilities but the few it needs and cannot gain privileges; Whisper, Ollama and cloudflared are pinned to tested
  versions; the installer turns on HSTS once it has seen a valid certificate. Left alone on purpose: the `ufw` rule that
  lets Docker's ranges reach LiveKit's signalling port, and Valkey without a password on loopback
  ([DEPLOYMENT-AND-TRANSPORT.md](../architecture/DEPLOYMENT-AND-TRANSPORT.md)).
- **Updates clean up after themselves** — **built 2026-11-16**: an update removes VTT Chat images older than the
  previous version (the test VM had collected 19 GB).
- **Fewer moving parts at start-up: the one-shot containers are folded into the services that need them** (Andy's idea,
  2026-11-15) — **built 2026-11-16** on the `stage-9-hardening` branch for 0.5.2. `media-init`, `recordings-init`, `models-init` and
  `ollama-pull` are gone: volume ownership comes from the images, the Whisper container fetches its own model
  (`whisper-start.sh`), and the worker pulls the summary model in the background and reports it to `vtt-admin status` and the
  status page. Checked on the dev PC: a fresh stack is healthy in 6 s, an in-place upgrade of the dev stack (GPU override)
  removes the old one-shots and comes up clean, failed downloads show as `FAIL local AI`, backup and restore still work. It
  also found and fixed a real bug: on a Compose install the worker could not delete raw audio (wrong user). Design, rules and
  the before/after: [DEPLOYMENT-AND-TRANSPORT.md](../architecture/DEPLOYMENT-AND-TRANSPORT.md#start-up-and-idle-cost).
  The Compose end-to-end records test passes on the new images (46 of 46), after it found and we fixed a shipped bug: since
  0.4.3 no audio reached Whisper over HTTP (see the changelog). **Not yet run:** the compatibility Whisper image, and the real VM.
- **Idle CPU on the server** (added 2026-11-16, Andy saw about 15% on the test VM) — **cause found and fixed 2026-11-16** on
  the same branch. It was not our code (backend 0.17% of a core, worker 0.10%): it was Docker running 43 health-check
  commands a minute, two of them expensive, about a quarter of a core of a 2010 Xeon. Health checks now poll every 2 s only while a container starts and once a minute after that, with cheap
  commands (needs Docker Engine 25+). On the dev PC: 43 → 6 commands a minute. On `main` since `v0.5.1-dev.2`. **Measured on the VM 2026-11-16:**
  the containers fell from 26.7% to 6.4% of a core and the machine from 52.8% to about 35%. The rest is the Docker daemon
  (27%), which a profile traces to a host monitoring agent listing 52 images every 30 s, not to this stack; with the images pruned and the agent at 5 min the machine idles at 8.8% of one core.
- **Old images after updates** (found 2026-11-16) — the VM held 52 images, 19 GB, eight past versions of each of ours. **Built
  2026-11-16** (Andy: yes, automatically): an update removes VTT Chat's own images older than the version it replaced, once
  the new one is healthy; `--keep-images` skips it.

**Moved to Stage 11 (0.6.1), not done:** the Windows popup-fix check, a real recorded session through the new records pipeline on the VM, the audio engine measured (headsets, latency, CPU), macOS and Linux-desktop parity, the 8+ hour soak, packaging and signing, the compatibility Whisper image on the real VM.

**Done when:** a full real campaign session runs on all supported platforms without manual intervention. (Checked in Stage 11.)

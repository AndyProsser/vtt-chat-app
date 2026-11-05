# Deployment & Transport

How an operator stands up their own instance, what network they must provide, and what is optional.

**Principle (decided 2026-11-05): self-host first, zero cloud reliance.** The default install runs
everything on one server the operator controls, with no third-party account. Cloudflare and other
cloud services are **optional adapters for advanced users** and must never be load-bearing. Other
people are expected to deploy their own instance, so every step must be documentable by someone who
is not Andy.

## Default topology

```mermaid
flowchart TB
    subgraph Internet
        P["Players\n(tray app / mobile SPA)"]
    end
    subgraph Server["One Ubuntu Server (VM or host) — native services, systemd"]
        Caddy["Caddy :443\nTLS + reverse proxy"]
        API["backend"]
        LK["LiveKit SFU"]
        Eg["LiveKit Egress"]
        Pipe["ai/ worker"]
        W["Whisper.cpp"]
        O["Ollama"]
        PG[("Postgres")]
        R[("Redis")]
        FS[("Local storage")]
    end
    P -->|"HTTPS / WSS 443"| Caddy
    Caddy --> API
    P <==>|"WebRTC media: UDP range\n(+ 7881/tcp fallback)"| LK
    API --> PG & R
    API --> LK
    LK --> Eg --> FS
    FS --> Pipe --> W
    Pipe --> O
```

## Ports the operator must provide

Only the operator opens anything; players configure nothing. **Opening UDP for voice is accepted**
(decided 2026-11-05).

| Port | Proto | Required | Purpose |
| --- | --- | --- | --- |
| `443` | TCP | yes | Caddy: HTTPS API, WebSocket, status page, SPA, client downloads |
| `80` | TCP | yes (ACME) | Caddy certificate issuance / http→https redirect |
| LiveKit media range (default `50000–60000`) | UDP | yes | WebRTC media. The range is configurable — narrow it for a small group |
| `7881` | TCP | yes | LiveKit ICE-over-TCP fallback for clients that can't use UDP |
| `7882` | UDP | optional | Single-port UDP mux, an alternative to the range |
| `3478/udp`, `5349/tls` | | optional | LiveKit's **built-in** TURN, for restrictive networks |

Signalling (`7880`) sits behind Caddy and is not exposed directly.

### Why STUN alone is usually enough

Players connect to the SFU, never to each other. The SFU is the public-facing side of every
connection, so a client behind NAT (even CGNAT) only needs outbound UDP and its own reflexive
address. That makes STUN plus the TCP fallback sufficient for most networks.

### Restrictive networks (hotel wifi, corporate, school)

Some networks block UDP and every port except 443. Options, in the order we recommend them:

1. **LiveKit built-in TURN/TLS on 443** — native to the LiveKit binary, no extra service, no
   third party. Off by default; an operator toggle. This is the self-host answer.
2. **7881/tcp ICE fallback** — already on, covers networks that allow arbitrary outbound TCP.
3. **Cloud TURN (e.g. Cloudflare TURN)** — _advanced, optional._ Useful when the operator can't
   open a UDP range at all, or wants relays near players. It is configured as an extra ICE server
   in LiveKit/client config. It is a convenience, not a dependency; nothing may require it.

### What does _not_ work

**Cloudflare Tunnel cannot carry WebRTC media** (UDP) or the TCP ICE fallback. It can front the
HTTPS/WSS paths only. An operator who uses a tunnel for the web side still has to expose the media
ports directly, or fall back to option 3.

## Optional adapters (advanced users)

All behind an explicit config switch, all absent from the default install, and none may be assumed
by application code:

| Adapter | What it replaces | Why someone would want it |
| --- | --- | --- |
| Cloudflare TURN | nothing (adds relays) | Can't open UDP; players on hostile networks |
| Cloudflare Realtime SFU | self-hosted LiveKit | Don't want to run an SFU. Large change: it affects tokens, rooms, egress — treat as a separate, later design. LiveKit and Cloudflare SFU overlap (both SFU + TURN); the system targets LiveKit |
| Cloudflare Pages / Workers | serving `web/` and `status/` from the box | Offload static hosting |
| Workers AI, OpenAI, Claude, etc. | local Whisper.cpp / Ollama | Underpowered server, or better quality |
| Authelia / OIDC | built-in identity | Operator already runs SSO (depends on the identity decision) |

Any adapter that sends session audio or transcripts off the server must be an explicit operator
decision and must be visible to users (see [RECORDING-AND-SUMMARIES.md](RECORDING-AND-SUMMARIES.md) privacy rules).

## Install model

- A **bash install script** on a blank Ubuntu Server installs and configures Caddy, Postgres,
  Redis, Node.js, LiveKit server + Egress, ffmpeg, Whisper.cpp and Ollama, generates secrets and
  config, and installs systemd units. Optional one-line `curl` installer.
- **No Docker** at present. Offering an optional container bundle for other self-hosters is an
  **open question** (tracked in `.claude/intent.md`); do not add one without Andy's say-so.
- `ufw` rules are an operator-time decision (LAN-only for a private group, or open for a public
  one) — the script asks, it doesn't hardcode.

## Sizing guidance (to be firmed up by the Stage 2 spike)

The server runs the SFU, Postgres, Redis, the API, Egress, Whisper.cpp and an LLM. Voice itself is
light; **transcription and summarisation are the heavy parts**, and they can run after the session.
The doc to write once measured: minimum spec for "voice + records on a small group", and what a GPU
buys. Until then, don't promise a spec.

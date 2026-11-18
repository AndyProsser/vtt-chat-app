# Security policy

VTT Chat App is self-hosted: each operator runs their own server. A security problem can therefore affect a real
group's voice, chat and session recordings, and we want to hear about it **privately** before it is public.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting instead:
**Security tab → Report a vulnerability** on this repository. If that is not available, contact the maintainer
through the email address on their GitHub profile ([@AndyProsser](https://github.com/AndyProsser)).

Include what you found, the version of the server and app (`vtt-admin status` shows the server's), how to reproduce it,
and what you think an attacker could do. You will get an answer, and credit in the release notes if you want it.

## What is in scope

- The server (`backend/`, the records worker in `ai/`, the install scripts in `infra/`), the desktop app (`tauri-client/`) and the
  web app (`web/`).
- Anything that lets someone read another campaign's chat, handouts, loot, recordings, transcripts or summaries; act as
  another user; bypass the Game Master's controls; or skip the recording-consent cue.
- Secrets handling: credentials written to logs, to a world-readable file, or into a container image.

Out of scope: problems that need an operator to misconfigure their own server on purpose, attacks that need
root on the server, denial of service by a person who is already a campaign member, and findings in third-party
software we only run (LiveKit, Whisper, Ollama, Postgres, Caddy), which should be reported to those projects.

## Supported versions

Only the **latest release** gets security fixes. Client and server must match on MAJOR.MINOR, so update both
together ([RELEASING.md](docs/guides/RELEASING.md), [VERSIONING-AND-DEPLOYMENT.md](docs/architecture/VERSIONING-AND-DEPLOYMENT.md)).

## Our practices

Secrets never go in the repository, the updater signing key is held outside it, containers run with their
capabilities dropped, and design decisions about access and privacy are written down in
[docs/architecture/](docs/architecture/).

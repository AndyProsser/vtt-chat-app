# Archive — the "DDB overlay" design

Everything under this directory belongs to the **previous design** of VTT Chat App: a Tauri
browser that loaded D&D Beyond in a WebView, authenticated with DDB's cobalt cookie, and injected a
React overlay into the Maps VTT canvas.

That design was replaced on **2026-10-29** (direction) / **2026-11-05** (repo rewrite) by a
self-hosted, audio-only **system-tray app** with no embedded browser. See
[../architecture/OVERVIEW.md](../architecture/OVERVIEW.md) and [../../ROADMAP.md](../../ROADMAP.md).

Nothing here is a current requirement. It is kept because:

- git history alone is a poor way to find "why did we decide X" months later;
- some of it is genuinely reusable (see the table below);
- the WebKitGTK investigation is a finished, upstream-reportable piece of work in its own right.

**Do not follow these documents as instructions.** If a current doc and an archived doc disagree,
the current doc wins.

| Path | What it was | Still useful for |
| --- | --- | --- |
| `WEBKITGTK-NVIDIA-EGL-CRASH.md`, `WEBKITGTK-NVIDIA-VIDEO-GREENSCREEN.md`, `issue-drafts/`, `patches/`, `scripts/webkitgtk-investigation/` | Root-causing WebKitGTK crashes and blank renders on NVIDIA when loading DDB | Upstream bug reports. Irrelevant to the tray app unless a future panel embeds a WebKitGTK page — panels are local React pages, so it should not matter. |
| `scripts/dev-with-patched-webkitgtk.sh` | Ran the dev stack against a locally patched WebKitGTK | Nothing |
| `architecture/DDB-AUTH.md` | Cobalt cookie → JWT exchange, DDB login flow, Akamai notes | **Optional** DDB character import — the Character Service endpoints and the "re-exchange, don't cache" lesson. The login-flow sections no longer apply. |
| `superpowers/specs/`, `superpowers/plans/` | Stage 1–3a designs and implementation plans (dev VM, shell hardening, overlay compact view, WS layer "Plan B", conditions "Plan C") | **Plan B's** Rust-owned WebSocket state machine with a bounded replay buffer is the likeliest thing to be revived for the new client/server sync layer. Plan A (overlay UI) and Plan C (D&D conditions) are obsolete. |

Prior art from the two earlier repos (`vtt-chat`, `vtt-chat-extension`) is a separate matter — see
[.claude/CLAUDE.md](../../.claude/CLAUDE.md) §15.

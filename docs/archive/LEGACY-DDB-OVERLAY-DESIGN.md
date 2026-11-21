# Legacy record: the DDB-overlay design

> **Moved from [ROADMAP.md](../../ROADMAP.md) on 2026-11-21.** What happened to the first four stages of the previous design, and what carried over. Archived, not a requirement. Index: [README.md](README.md).

## Legacy record: the DDB-overlay design

For anyone wondering what happened to the first four stages. Details are in [docs/archive/](README.md).

| Old stage                                                 | Outcome                       | What carried over                                                                                                                                                                                                      |
| --------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Foundations                                           | 🟢 kept                       | Everything                                                                                                                                                                                                             |
| 0.5 — State & resilience                                  | 🟢 kept, revised              | Everything; added "hidden is the default"                                                                                                                                                                              |
| 1 — Walking skeleton: DDB auth + voice                    | ⚫ superseded                 | `rust-livekit` audio capture/publish/subscribe/playback and the `loopback` harness; LiveKit token issuance in `backend/`. The DDB-auth half was never verified against live traffic (no second account) and is dropped |
| 2 — Hotkeys, page restriction, ad-block                   | ⚫ superseded                 | The **hotkey findings**: bare-modifier PTT can't be a global shortcut; Wayland global shortcuts silently no-op. Page restriction and ad-block are gone with the embedded browser                                       |
| 3a — Overlay UI (Plans A/B/C)                             | ⚫ superseded                 | Plan B's Rust-owned WebSocket model with a bounded replay buffer is the candidate for client↔server sync. Plan A (overlay) and Plan C (D&D conditions) are obsolete                                                    |
| 3b — DDB DOM extraction                                   | ⚫ dropped                    | —                                                                                                                                                                                                                      |
| 3.5 — Text chat                                           | ⚫ folded into Stage 6        | —                                                                                                                                                                                                                      |
| 4 — Multi-window & DM controls                            | ⚫ replaced by Stages 4 and 6 | Group/party model                                                                                                                                                                                                      |
| 5–8 — Persistence, status page, CLI, AI plugin, hardening | ⚫ reshaped                   | Became Stages 3, 5, 8, 9. **The AI plugin is no longer "optional, future" — it is core (Stage 5).**                                                                                                                    |

Two other things that ended with the old design, deliberately recorded so they aren't rediscovered:

- **The WebKitGTK/NVIDIA EGL crash** (a null-pointer path in WebKitGTK's accelerated backing store, then NVIDIA's proprietary EGL driver) and the blank-render follow-on were investigated at length and are archived. They affected only the embedded DDB browser. Panels are local React pages, so they should not matter to the tray app; if a panel ever shows a blank render on Linux+NVIDIA, start from the archive.
- **The animated-Maps-background blank render** was never root-caused and is moot.

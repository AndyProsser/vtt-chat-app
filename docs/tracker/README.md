# The build tracker

The record of how the project was built: the design, the decisions and who made them, and what shipped when. It exists so that [ROADMAP.md](../../ROADMAP.md) can stay a short plan with a one-line summary per stage, without losing the reasoning that used to live in it. Nothing here is a task list.

## Where things are written down

| You want to know                                           | Read                                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| What was delivered per stage, and what is next             | [ROADMAP.md](../../ROADMAP.md)                                               |
| Why a stage was built the way it was, and who decided what | the stage files below                                                        |
| What is built against what has really run, on which date   | [BUILD-STATUS.md](../BUILD-STATUS.md)                                        |
| What changed for players and operators in each release     | [CHANGELOG.md](../../CHANGELOG.md)                                           |
| How a part of the system works today                       | [docs/architecture/](../architecture/) and the [guides](../guides/README.md) |
| How the next stage's testing will work                     | [QUALITY-VALIDATION.md](../architecture/QUALITY-VALIDATION.md)               |
| The previous (browser-overlay) design                      | [docs/archive/](../archive/README.md)                                        |

## The stage files

Each is the stage's section of the roadmap, moved here **verbatim on 2026-11-21**, so its wording, dates and "decided by Andy" notes are as they were written. Where a later decision changed something, the stage file says so in place; the current design is in `docs/architecture/`.

| File                                                                   | Covers                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PROGRESS-LOG-2026-11.md](PROGRESS-LOG-2026-11.md)                     | The roadmap's "where we are" narrative to 2026-11-18: build queues, stock-takes, the 0.4 to 0.5 releases                                          |
| [STAGES-0-TO-8.md](STAGES-0-TO-8.md)                                   | Foundations, state and resilience, pivot cleanup, audio spike, server core, deployment, tray client, records, table features, web app, operations |
| [STAGE-09-HARDENING.md](STAGE-09-HARDENING.md)                         | Hardening and production readiness (0.5.1 to 0.5.3)                                                                                               |
| [STAGE-10-INTEGRATIONS-AND-LOOT.md](STAGE-10-INTEGRATIONS-AND-LOOT.md) | Optional integrations, and the loot and chat-history spec                                                                                         |
| [STAGE-11-PROTOCOL-4.md](STAGE-11-PROTOCOL-4.md)                       | Protocol 4 (0.6.0), verification (0.6.1), GM Notes spec                                                                                           |
| [STAGE-12-STORYTELLING.md](STAGE-12-STORYTELLING.md)                   | The AI roles, personas, campaign memory, the Claude and OpenAI connectors                                                                         |
| [STAGE-13-QUALITY-VALIDATION.md](STAGE-13-QUALITY-VALIDATION.md)       | The end-to-end validation: the demo campaign, its runs, the manual sweep (closed 2026-11-24)                                                      |

## Completed plans and specs

Implementation plans and design specs written while building, kept once the work shipped. The checkboxes in the plans were never ticked as the work went; the work is built (see the stage files and [BUILD-STATUS.md](../BUILD-STATUS.md)). New plans and specs are written under `docs/superpowers/` while the work is open, and **moved here when it ships**.

| Date       | Plan                                                               | Spec                                                                     | Built as        |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ | --------------- |
| 2026-11-08 | [Main window](plans/2026-11-08-main-window.md)                     | [Main window design](specs/2026-11-08-main-window-design.md)             | Stage 4         |
| 2026-11-11 | [App sign-in](plans/2026-11-11-app-sign-in.md)                     |                                                                          | 0.4, protocol 2 |
| 2026-11-15 | [Campaign details](plans/2026-11-15-campaign-details.md)           | [Email and invites design](specs/2026-11-15-email-and-invites-design.md) | 0.4.x           |
| 2026-11-15 | [Email links](plans/2026-11-15-email-links.md)                     | (same)                                                                   | 0.4.x           |
| 2026-11-15 | [Invite page](plans/2026-11-15-invite-page.md)                     | (same)                                                                   | 0.4.x           |
| 2026-11-16 |                                                                    | [Starter sounds design](specs/2026-11-16-starter-sounds-design.md)       | 0.5.x           |
| 2026-11-17 | [Loot and chat history](plans/2026-11-17-loot-and-chat-history.md) |                                                                          | 0.5.x and 0.6.0 |

The older plans and specs of the abandoned design are in [docs/archive/superpowers/](../archive/superpowers/).

## Keeping it current

- When a stage closes, move its detail here and leave **one row** in the roadmap's summary table.
- When a plan or spec ships, move it to `plans/` or `specs/` here and add a row above.
- Do not edit the stage files to look current. Add a dated note in place, and update the architecture doc that describes how it works now.
- **Stage numbers after 13 changed on 2026-11-24.** A no-wire polish stage was inserted as Stage 14, so the protocol bump is now Stage 15 and the idea stages are 16 to 18. Links in this folder were updated; where a closed stage's text says "Stage 14" for the bump (Stage 12's file, for example), it means Stage 15 now.

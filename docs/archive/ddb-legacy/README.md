# ddb-legacy

Source from the previous design, removed from the live tree in ROADMAP Stage 1 and kept for reference. The files carry a `.txt` suffix on purpose so the linter and compiler ignore them.

| File                            | Was                                                   | Still useful for                                                                                                                         |
| ------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `cobalt.ts.txt`                 | `CobaltSession` cookie → short-lived DDB JWT exchange | The "re-exchange, don't cache" lesson if a token-based import is ever added                                                              |
| `characterService.ts.txt`       | Authenticated Character Service / campaign calls      | Endpoint URLs and response shapes (**authenticated** endpoints — the planned public-URL import uses different, public ones; verify live) |
| `identity.ts.txt`               | Cookie → identity orchestrator                        | Nothing: identity is now this app's own ([CLAUDE.md §11](../../../.claude/CLAUDE.md))                                                    |
| `consts.ts.txt`, `types.ts.txt` | DDB URLs and raw response types                       | Endpoint reference                                                                                                                       |
| `appSession.ts.txt`             | App-session JWT carrying DDB claims (from `backend/`) | Nothing: sessions are redesigned (long-lived, remotely revocable)                                                                        |

Context: [architecture/DDB-AUTH.md](../architecture/DDB-AUTH.md).

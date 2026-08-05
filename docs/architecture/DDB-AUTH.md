# D&D Beyond Auth Flow

How identity gets from "user is logged into D&D Beyond" to "app knows who you are, what character you're playing, and whether you're the DM" — with no separate account and no separate login. See [CLAUDE.md §8.1, §8.5, §11](../../CLAUDE.md) for the requirements this implements.

## Why This Differs From the Prior System

The archived `vtt-chat-extension` did this via a browser extension that scraped DDB pages and intercepted `webRequest` traffic, then handed a trust-delegation payload to a separate backend (see [CLAUDE.md §15–16](../../CLAUDE.md)). That required shipping and maintaining a Chrome/Firefox/Edge extension.

This system does the equivalent **inside the Tauri WebView directly** — there is no separate extension, and no separate browser involved. The trust model is the same idea (DDB has already authenticated this user; we don't ask them to authenticate again), just without a second artifact to build and distribute.

## Flow

1. **Cobalt cookie detection.** The Tauri shell (`tauri-client/src-tauri/`) loads D&D Beyond in a WebView and detects the `CobaltSession` cookie once the user is logged into DDB normally.
2. **JWT exchange.** The shell (or the `ddb/` module invoked from the shell) `POST`s the cobalt cookie to DDB's `/v1/cobalt-token` endpoint, exchanging it for a short-lived JWT. This is DDB's own token exchange — not something this app issues.
3. **Character Service calls.** The JWT authenticates calls to DDB's Character Service to fetch the user's character list, selected character, and campaign membership.
4. **DOM extraction (supplementary).** Anything not available cleanly via API (e.g. current map, live token conditions) is extracted from the DDB Maps page DOM by `overlay-ui`, per [CLAUDE.md §8.5](../../CLAUDE.md).
5. **DM role detection.** DM status is derived from DDB campaign metadata (the campaign owner field), not from anything this app stores — see [CLAUDE.md §11](../../CLAUDE.md).
6. **App session issuance.** The extracted identity (external user ID, selected character, campaign ID, DM flag) is handed to `backend/`, which issues this app's own session/LiveKit token. From here on, the app's session is what authorizes REST calls and LiveKit room joins — the DDB JWT isn't re-sent on every request.

## Trust Boundary

| Trusted                                                | Not trusted                                              |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| Character/campaign membership as reported by DDB's API | Any identity claim not backed by the cobalt cookie exchange |
| DM status from the campaign owner field                | Role escalation beyond what DDB's campaign data indicates   |
| Character metadata (name, class, HP, etc.) from DDB     | Arbitrary metadata not sourced from DDB                      |

This app never asks the user for a password, and never stores one. D&D Beyond's own session is the only credential.

## Open Questions (to resolve during implementation)

- Exact cobalt cookie access mechanism from within a Tauri WebView (cookie store API vs. request interception) — needs a spike against Tauri's current cookie APIs per platform (WebView2 / WebKit / WebKitGTK).
- JWT refresh behavior for long-running sessions (campaigns run for months) — the cookie may need periodic re-validation rather than a one-time exchange.

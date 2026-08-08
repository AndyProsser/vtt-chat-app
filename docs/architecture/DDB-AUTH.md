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

## Login Flow (Wizards Account, Auth0)

Before any `CobaltSession` cookie exists, the user reaches DDB's sign-in link, which navigates to Wizards' hosted login at `myaccounts.wizards.com/login` with a standard OAuth2 authorization-code request. Confirmed live (Stage 1):

```text
https://myaccounts.wizards.com/login?client_id=7G6UYZSMWRBL5AT5EDFJXCBTE4&prompt=consent
  &redirect_uri=https%3A%2F%2Fwww.dndbeyond.com%2Foauth-wizards-callback
  &response_type=code&scope=email&state=<base64>&version=2
```

- `client_id` — DDB's registered Auth0 client, confirmed live as `7G6UYZSMWRBL5AT5EDFJXCBTE4`.
- `redirect_uri` — `https://www.dndbeyond.com/oauth-wizards-callback`. DDB's own callback handler completes the exchange and sets `CobaltSession` server-side once Wizards' Auth0 issues the authorization code; this app never sees that exchange, only the resulting cookie.
- `response_type=code`, `scope=email`, `state` — standard Auth0 authorization-code parameters. `state` is base64 and decodes to `<random-id>|<origin>|<return-url>` in the observed sample (e.g. the return URL is the character-sheet page the user started from).

This confirms what was previously an assumption in this doc: **DDB delegates real authentication to a Wizards-owned Auth0 tenant**; DDB itself never handles a password. The trust model in this document (this app never asks for or stores a password) holds one level further up than originally documented — it's true of DDB *and* of Wizards.

## Known Issue: Login Form Fails Under WebKitGTK (Akamai Bot Manager)

Loading `myaccounts.wizards.com/login` directly (without OAuth params) renders a page offering email/password *and* OAuth options (Google, Apple, Steam). On Linux — reproduced in both Epiphany (GNOME Web) and this app's WebView, i.e. it's WebKitGTK itself, not app code — the plain email/password form does not submit correctly; login silently fails to complete. Steam/Google/Apple OAuth work fine on the same page, on the same machine.

**Root cause.** The login domain is fronted by **Akamai Bot Manager** — confirmed via the `_abck` and `bm_sz` cookies it sets. Akamai fingerprints the browser (JS engine behavior, WebGL vendor/renderer strings, timing characteristics, sensor telemetry) and scores how trustworthy the client looks. WebKitGTK-on-Linux is a comparatively rare fingerprint next to Chrome/Firefox/Safari-on-supported-OSes, and plausibly scores low enough that the credential POST is silently dropped or degraded server-side, with no visible error. OAuth flows redirect to a completely different domain (Google's/Apple's/Steam's own login), which has nothing to do with Wizards' Akamai config, so the blocked code path never runs — this is why OAuth reliably works around it.

**Mitigation history (Stage 1).** First attempt: a Linux-only popup window that intercepted navigation to `myaccounts.wizards.com` and reopened it with the UA spoofed to a common desktop Chrome string. **Live-tested and confirmed worse, not better** — the login flow's own JS requests came back as an HTML "Site Maintenance" page (a disguised WAF block) instead of the JSON the same requests return under the real UA. This was reverted.

Second attempt, live-tested directly in the WebView's devtools by trying several UA strings against the real login flow:

| UA claimed | Result |
| --- | --- |
| WebKitGTK's real UA | fails (silent — the original symptom) |
| Chrome (Linux) | fails (active block — the reverted attempt above) |
| Safari-on-Ubuntu (an inconsistent combination that doesn't exist in the real world) | fails |
| **Firefox (Linux)** | **works** |

Firefox is the one UA that gets through. Most plausible explanation: anti-bot vendors invest far more heavily in detecting Chromium-engine mismatches than Gecko ones, because the overwhelming majority of headless automation (Puppeteer, Playwright, Selenium) impersonates Chrome — claiming Firefox is comparatively under-scrutinized, not necessarily "safe" in principle. It's still a UA claim that doesn't match the underlying engine, so treat it as fragile: Akamai's ruleset can change without notice, and there's no guarantee this keeps working.

**Mitigation implemented (Stage 1, Linux only).** `tauri-client/src-tauri/src/consts.rs`'s `LINUX_UA_OVERRIDE` sets the WebView to a Firefox-on-Linux UA string, applied to the whole main window in `lib.rs` (not scoped to just the login domain like the reverted Chrome attempt) — unlike Chrome, this hasn't shown any downside on `/characters` or Maps VTT, so the added complexity of a separate popup window wasn't justified. **Steam/Google/Apple OAuth remains the documented fallback** if this override ever stops working — it needs no UA games at all and covers most of this app's actual audience (D&D players skew heavily toward already having a Steam account).

## Resolved: Cookie Access, Exchange & Refresh (Stage 1)

**Cookie access.** Tauri's `WebviewWindow::cookies_for_url()` (Tauri ≥2.4.0, built on wry ≥0.47) reads cookies for a given http/https URL — including httpOnly ones — across Windows (WebView2), macOS (WebKit), and Linux (WebKitGTK). It is not available for `tauri://`/`file://` schemes, which doesn't matter here since DDB is loaded over https. **It must be called asynchronously, off the main thread** — Tauri's own docs flag a Windows-specific deadlock risk if called synchronously on the UI thread. `src-tauri` calls this after the DDB window has loaded, looking for the `CobaltSession` cookie on `dndbeyond.com`.

The `CobaltSession` cookie is very likely httpOnly: the archived `vtt-chat-extension` needed the privileged `chrome.cookies` API rather than reading `document.cookie` from a content script, which only makes sense if page-context JS can't see it. This is consistent with needing `cookies_for_url` (a privileged, Rust-side read) rather than any JS-side approach.

**Cobalt → JWT exchange.** `POST https://auth-service.dndbeyond.com/v1/cobalt-token` with the cookie. The resulting JWT is short-lived — approximately 5 minutes, per the archived repo's currency-writeback doc (`nbf`/`exp` ~300s apart). Neither archived repo captured an exact request/response body for this endpoint; `ddb/`'s client assumes a `{ token: string }` response (the commonly-documented DDB shape) and passes the cookie as a `Cookie: CobaltSession=<value>` header, but **this needs live-traffic verification during implementation** — flagged as a verify-as-you-go item, not a hard blocker to writing the client.

**Refresh behavior.** There is no refresh-token mechanism for this JWT. The pattern is **re-exchange, not caching**: re-POST `/v1/cobalt-token` using the still-valid `CobaltSession` cookie to get a fresh JWT before each Character Service call, rather than reusing a cached token that may have expired. The archived repo's explicit warning applies here too: any flow needs a fresh token at call time, not a cached one. `CobaltSession` cookie expiry/re-validation itself is DDB's own session lifetime and is out of scope for this app — if the cookie itself is gone, the user needs to log into DDB again, which surfaces naturally as a failed exchange.

**Character Service reads.** `GET https://character-service.dndbeyond.com/character/v5/characters/list?userId=<id>` → character list. DM detection: `GET https://api.dndbeyond.com/campaigns/v1/details/:id` → `data.dmId`, compared against the logged-in user's id. The auth header format for these reads was never explicitly confirmed in the archived docs — assumed to be `Authorization: Bearer <jwt>` (the confirmed pattern on the one documented write endpoint) and needs live verification alongside the exchange endpoint above.

# Sign-in options: password, emailed code, single sign-on

Three ways in, all ending in the same long-lived, revocable session ([CLAUDE.md §11](../../.claude/CLAUDE.md)). **Only the password works with no setup.** The other two are optional and the page offers only what the server reports (`GET /api/auth/providers` → `{ oidc, mail }`).

> **Changed 2026-11-11 (0.4):** all three now happen **in the browser** (the join page or `/connect`), never in the app. The app only _connects_: it takes a one-time link code (deep link or typed) or has a device request approved in a signed-in browser (the app's QR, scanned by a phone, opens that page) ([APP-SIGN-IN.md](APP-SIGN-IN.md)). The app's typed-code box ("Have a code? Type it here") accepts **any one-time sign-in code**: a link code, an emailed code, a `vtt-admin user code … signin` code, or the code the SSO page shows. A short code is normalised in the app; anything else is sent as typed and the server checks it. The password, code and SSO forms in the app exist only behind `VTT_DEV_SIGNIN=1` ([DEVELOPING.md](../../DEVELOPING.md)). The "in the app" wording below describes how those methods work, and how the dev forms behave.

| Method         | Needs                                                                                   | How the player uses it                                                                     |
| -------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Password       | nothing                                                                                 | email + password (browser; in the app only with `VTT_DEV_SIGNIN`)                          |
| Code           | nothing to issue by hand (`vtt-admin user code <email>`); `SMTP_URL` to have it emailed | "Use a code instead" → **Email me a code**, paste it                                       |
| Single sign-on | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `PUBLIC_URL`                     | "Use a code instead" → **Sign in with single sign-on** → browser → paste the code it shows |

## Why SSO ends in a code

The tray app has no browser redirect handling and shouldn't grow any. The OIDC callback page proves who you are, then shows a **one-time code**, which is exactly what the emailed-code sign-in already accepts. So SSO adds one small server route and no new client protocol, and the session model stays single.

```mermaid
sequenceDiagram
  participant A as App
  participant B as Browser
  participant S as Backend
  participant I as Identity provider
  A->>B: open /api/auth/oidc/
  B->>S: GET /api/auth/oidc/
  S-->>B: redirect (state, nonce, PKCE challenge)
  B->>I: sign in
  I-->>B: redirect to /callback?code&state
  B->>S: GET /callback
  S->>I: exchange code (+ PKCE verifier)
  I-->>S: ID token
  S-->>B: page showing a one-time code
  B-->>A: player pastes the code
  A->>S: redeem code → session
```

## Decisions and why

- **SSO signs in; it does not sign up.** The code is only issued for an email that already has an account (made from an invite). Otherwise anyone at your identity provider could join every instance that trusts it. Cost: a new player still opens the invite link once.
- **The email must be verified by the provider** (`email_verified: true`), or the sign-in is refused: an unverified address could belong to someone else.
- **Standard protections:** authorization code with PKCE (S256), a random single-use `state` (10 minutes, bounded), a `nonce` check, ID-token signature, issuer and audience verified against the provider's published keys.
- **Codes are single-use and expire in 15 minutes**, are never logged, and requests are rate-limited. The "email me a code" reply is identical whether or not the address has an account or the server can send mail.
- **Plain-text mail through the operator's own SMTP server** (`SMTP_URL`, e.g. `smtps://user:pass@mail.example.com:465`, `MAIL_FROM`). No tracking, nothing to click.
- **Footprint:** SMTP adds the `nodemailer` library (pure JS); SSO adds nothing beyond `jose`, which the backend already used.

## Visitor sign-up requests

A person with no invite can ask the operator for an account. It is **off by default** (`signup.requests`) because it adds a public write endpoint; the operator opts in, and approves in the Admin CLI (there is no admin web UI, §7 of CLAUDE.md).

```mermaid
sequenceDiagram
  participant V as Visitor (front page)
  participant S as Server
  participant O as Operator (vtt-admin)
  V->>S: POST /api/signup-requests {email, name, message}
  S-->>V: 202 {ok:true} (same whether or not the address is known)
  O->>S: signup list / signup approve
  S->>S: create account (no password, notice not accepted), issue 8-character code
  O-->>V: code, on a side channel
  V->>S: redeem code (front page, "I have a sign-in code")
  S-->>V: session, needsConsent: true
  V->>S: accept the recording notice
```

Why it is shaped this way:

- **The operator hands the code over, nothing is emailed.** Approval needs no SMTP, and handing the code to the person on a channel the operator already trusts is what ties the request to a real human. It reuses the one-time code path (`user code`), so there is no new way to sign in.
- **No enumeration.** A repeat request, or one for an address that already has an account, gets the same `202`; a request for a new address stores a row. The only visible refusals are rate limiting, the open-request cap (200), bad input, and `404` when the feature is off.
- **Consent is never accepted on the person's behalf.** The account is created with no accepted notice, so the first sign-in shows the recording notice (the same screen a changed notice uses).
- **Bounded and cleaned.** Name 1-80 characters and message at most 500, control and bidirectional-override characters stripped (as for device labels), 5 requests per address per hour, at most 200 pending, one pending per address.
- **Version:** this adds a public endpoint and a field in `/api/auth/providers`; 0.4 is still unreleased, so no version bump.

## First account: a starter campaign

Why: a brand-new instance has no campaigns, and a fresh account would otherwise land on "Not in a campaign yet"
with nowhere to go. Rule: only when the user is an Admin, belongs to no campaign, and the instance has no campaigns
at all, one campaign is created with a randomly chosen dry-humour name and that account is its DM. It is idempotent
and applies to no one else. It is hooked into `AccountService.signInUser`, which every sign-in path uses (so an
existing first account gets one the next time it signs in), and into `vtt-admin user create`. How later accounts
find or request a campaign is a separate, undecided design.

## Sessions in the browser, and OIDC

Whatever the sign-in method, the result is the same opaque server session, and the browser holds it as an HttpOnly
cookie (see [APP-SIGN-IN.md](APP-SIGN-IN.md)). A future web OIDC callback would call the same session-creation code,
set that cookie and redirect home, with no token in a URL. The desktop app keeps the one-time-code page, because it
cannot take a redirect.

## Not verified

SSO was tested against a fake provider in the test suite (signing, PKCE, nonce, expiry, replay, unverified email), **not against a real Authelia or Keycloak**. SMTP is tested against a fake mailer, not a live mail server. Both need a first real run. Sign-up requests are unit and HTTP tested (memory store and Postgres), and have not been exercised in a browser.

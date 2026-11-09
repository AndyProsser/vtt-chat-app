# Sign-in options: password, emailed code, single sign-on

Three ways in, all ending in the same long-lived, revocable session ([CLAUDE.md §11](../../.claude/CLAUDE.md)). **Only the password works with no setup.** The other two are optional and the app offers only what the server reports (`GET /api/auth/providers` → `{ oidc, mail }`).

| Method         | Needs                                                                                   | How the player uses it                                                                     |
| -------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Password       | nothing                                                                                 | email + password in the app                                                                |
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

## Not verified

SSO was tested against a fake provider in the test suite (signing, PKCE, nonce, expiry, replay, unverified email), **not against a real Authelia or Keycloak**. SMTP is tested against a fake mailer, not a live mail server. Both need a first real run.

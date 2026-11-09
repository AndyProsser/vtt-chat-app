import { createHash, randomBytes } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Where the identity provider sends the browser back: `<PUBLIC_URL>/api/auth/oidc/callback`. */
  redirectUri: string;
}

export interface OidcIdentity {
  email: string;
  name: string | null;
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

interface Pending {
  verifier: string;
  nonce: string;
  expiresAt: number;
}

export class OidcError extends Error {}

const PENDING_TTL_MS = 10 * 60_000;
const MAX_PENDING = 500;

const b64url = (b: Buffer): string => b.toString('base64url');

/**
 * Sign-in through the operator's own identity provider (Authelia, Keycloak, …), authorization-code flow
 * with PKCE. Optional: without `OIDC_*` settings none of this exists. It proves *who someone is* (a
 * verified email); it does not make accounts. The caller maps the email to an existing account.
 */
export class OidcClient {
  private discovery: Promise<Discovery> | undefined;
  private jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly config: OidcConfig,
    private readonly now: () => number = Date.now,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /** The provider's page to send the browser to, with a fresh single-use state, nonce and PKCE challenge. */
  async begin(): Promise<string> {
    const d = await this.discover();
    this.prune();
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(32));
    const nonce = b64url(randomBytes(16));
    this.pending.set(state, { verifier, nonce, expiresAt: this.now() + PENDING_TTL_MS });
    const url = new URL(d.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', b64url(createHash('sha256').update(verifier).digest()));
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  /** Completes the sign-in the browser returns with. Throws {@link OidcError} for anything not right. */
  async complete(state: string, code: string): Promise<OidcIdentity> {
    const entry = this.pending.get(state);
    this.pending.delete(state); // single use, whatever happens next
    if (!entry || entry.expiresAt < this.now())
      throw new OidcError('the sign-in expired; start again');
    const d = await this.discover();
    const response = await this.fetchFn(d.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.redirectUri,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code_verifier: entry.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new OidcError('the identity provider refused the sign-in');
    const body = (await response.json()) as { id_token?: unknown };
    if (typeof body.id_token !== 'string')
      throw new OidcError('the identity provider sent no identity');
    this.jwks ??= createRemoteJWKSet(new URL(d.jwks_uri));
    let claims;
    try {
      ({ payload: claims } = await jwtVerify(body.id_token, this.jwks, {
        issuer: d.issuer,
        audience: this.config.clientId,
      }));
    } catch {
      throw new OidcError('the identity could not be verified');
    }
    if (claims.nonce !== entry.nonce) throw new OidcError('the identity could not be verified');
    // An unverified address could be anyone's: never map it to an account.
    if (typeof claims.email !== 'string' || claims.email_verified !== true)
      throw new OidcError('the identity provider has not verified your email address');
    return {
      email: claims.email.trim().toLowerCase(),
      name: typeof claims.name === 'string' ? claims.name : null,
    };
  }

  private discover(): Promise<Discovery> {
    this.discovery ??= this.fetchFn(
      `${this.config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
      { signal: AbortSignal.timeout(10_000) },
    )
      .then(async (r) => {
        if (!r.ok) throw new OidcError('the identity provider could not be reached');
        const d = (await r.json()) as Partial<Discovery>;
        if (!d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri || !d.issuer)
          throw new OidcError('the identity provider sent an incomplete configuration');
        return d as Discovery;
      })
      .catch((error: unknown) => {
        this.discovery = undefined; // try again next time
        throw error;
      });
    return this.discovery;
  }

  private prune(): void {
    const now = this.now();
    for (const [state, p] of this.pending) if (p.expiresAt < now) this.pending.delete(state);
    while (this.pending.size >= MAX_PENDING) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
  }
}

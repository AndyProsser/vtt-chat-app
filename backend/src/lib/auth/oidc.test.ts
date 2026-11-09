import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { oidcRoutes } from '../http/oidcRoutes.js';
import { MemoryStore } from '../store/memoryStore.js';
import { AccountService } from './accountService.js';
import { OidcClient, OidcError } from './oidc.js';

/** A tiny identity provider: discovery, JWKS, and a token endpoint that checks PKCE and signs an ID token. */
async function fakeProvider() {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  const state = {
    claims: { email: 'andy@example.com', email_verified: true, name: 'Andy' } as Record<
      string,
      unknown
    >,
    nonce: '',
    challenge: '',
    audience: 'client-1',
    tokenCalls: 0,
  };
  let base = '';
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', base);
    if (url.pathname === '/.well-known/openid-configuration') {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          jwks_uri: `${base}/jwks`,
        }),
      );
    } else if (url.pathname === '/jwks') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    } else if (url.pathname === '/token' && req.method === 'POST') {
      state.tokenCalls += 1;
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        const form = new URLSearchParams(body);
        const verifier = form.get('code_verifier') ?? '';
        const ok =
          form.get('client_secret') === 'secret' &&
          createHash('sha256').update(verifier).digest('base64url') === state.challenge;
        if (!ok) {
          res.statusCode = 400;
          res.end('{}');
          return;
        }
        const idToken = await new SignJWT({ ...state.claims, nonce: state.nonce })
          .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
          .setIssuer(base)
          .setAudience(state.audience)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ id_token: idToken }));
      });
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, state, close: () => server.close() };
}

const redirectUri = 'https://vtt.example.com/api/auth/oidc/callback';
let provider: Awaited<ReturnType<typeof fakeProvider>>;
let clock = 1_000_000;
let client: OidcClient;

beforeEach(async () => {
  provider = await fakeProvider();
  client = new OidcClient(
    { issuer: provider.base, clientId: 'client-1', clientSecret: 'secret', redirectUri },
    () => clock,
  );
});
afterEach(() => provider.close());

async function begin(): Promise<string> {
  const url = new URL(await client.begin());
  provider.state.nonce = url.searchParams.get('nonce') ?? '';
  provider.state.challenge = url.searchParams.get('code_challenge') ?? '';
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('redirect_uri')).toBe(redirectUri);
  return url.searchParams.get('state') ?? '';
}

describe('OidcClient', () => {
  it('signs in with a verified email', async () => {
    const state = await begin();
    expect(await client.complete(state, 'code')).toEqual({
      email: 'andy@example.com',
      name: 'Andy',
    });
  });

  it('refuses an unverified email, a wrong audience and a wrong nonce', async () => {
    provider.state.claims.email_verified = false;
    await expect(client.complete(await begin(), 'c')).rejects.toThrow(/not verified/);
    provider.state.claims.email_verified = true;
    provider.state.audience = 'someone-else';
    await expect(client.complete(await begin(), 'c')).rejects.toThrow(OidcError);
    provider.state.audience = 'client-1';
    const state = await begin();
    provider.state.nonce = 'tampered';
    await expect(client.complete(state, 'c')).rejects.toThrow(OidcError);
  });

  it('uses each state once, and lets it expire', async () => {
    const state = await begin();
    await client.complete(state, 'c');
    await expect(client.complete(state, 'c')).rejects.toThrow(/expired|start again/);
    const stale = await begin();
    clock += 11 * 60_000;
    await expect(client.complete(stale, 'c')).rejects.toThrow(/start again/);
    await expect(client.complete('never-issued', 'c')).rejects.toThrow(/start again/);
  });
});

describe('the callback page', () => {
  async function serve() {
    const store = new MemoryStore();
    const accounts = new AccountService({ store });
    await accounts.register({
      email: 'andy@example.com',
      displayName: 'Andy',
      password: 'correct horse battery',
      acceptedConsentVersion: '1',
    });
    const app = express();
    app.use('/oidc', oidcRoutes(client, accounts));
    const server = app.listen(0);
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { origin, close: () => void server.close() };
  }

  it('shows a one-time code to someone who has an account', async () => {
    const s = await serve();
    const state = await begin();
    const response = await fetch(`${s.origin}/oidc/callback?state=${state}&code=x`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toMatch(/<code>[A-Za-z0-9_-]{20,}<\/code>/);
    s.close();
  });

  it('does not make accounts: an unknown address gets an explanation, not a code', async () => {
    const s = await serve();
    provider.state.claims.email = 'stranger@example.com';
    const state = await begin();
    const response = await fetch(`${s.origin}/oidc/callback?state=${state}&code=x`);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('<code>');
    s.close();
  });

  it('starting redirects to the provider', async () => {
    const s = await serve();
    const response = await fetch(`${s.origin}/oidc/`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain(`${provider.base}/authorize?`);
    s.close();
  });
});

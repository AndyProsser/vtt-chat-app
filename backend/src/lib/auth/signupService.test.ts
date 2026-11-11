import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { MAX_PENDING_SIGNUP_REQUESTS } from '../../consts/index.js';
import { DomainError } from '../errors.js';
import type { Store } from '../store/store.js';
import { openTestBackend } from '../store/testing.js';
import { AccountService } from './accountService.js';
import { SignupService } from './signupService.js';

const backend = await openTestBackend();
afterAll(() => backend.close());

let store: Store;
let accounts: AccountService;
let signups: SignupService;

beforeEach(async () => {
  store = await backend.reset();
  accounts = new AccountService({ store, newId: backend.newId });
  signups = new SignupService({ store, accounts, newId: backend.newId });
});

const turnOn = async (): Promise<void> =>
  store.putSettings({ ...(await store.getSettings()), signupRequests: 'on' });
const code = (name: string): DomainError['code'] | undefined => name as DomainError['code'];

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof DomainError ? error.code : 'other';
  }
}

describe('submit', () => {
  it('refuses while the setting is off', async () => {
    expect(await codeOf(signups.submit({ email: 'a@x.test', displayName: 'A' }))).toBe(
      code('not_found'),
    );
    expect(await store.listSignupRequests()).toEqual([]);
  });

  it('stores a normalised, cleaned request', async () => {
    await turnOn();
    await signups.submit({
      email: '  Zed@X.Test ',
      displayName: ' Ze‮d\u0000 ',
      message: 'line one\r\nline two​',
    });
    expect(await store.listSignupRequests('pending')).toMatchObject([
      { email: 'zed@x.test', displayName: 'Zed', message: 'line one\nline two', status: 'pending' },
    ]);
  });

  it('validates the email, the name and the message', async () => {
    await turnOn();
    expect(await codeOf(signups.submit({ email: 'nope', displayName: 'A' }))).toBe('invalid_input');
    expect(await codeOf(signups.submit({ email: 'a@x.test', displayName: '  ' }))).toBe(
      'invalid_input',
    );
    expect(await codeOf(signups.submit({ email: 'a@x.test', displayName: 'x'.repeat(81) }))).toBe(
      'invalid_input',
    );
    expect(
      await codeOf(
        signups.submit({ email: 'a@x.test', displayName: 'A', message: 'm'.repeat(501) }),
      ),
    ).toBe('invalid_input');
    expect(await store.listSignupRequests()).toEqual([]);
  });

  it('answers the same for an existing account or pending request, and stores nothing new', async () => {
    await turnOn();
    await accounts.register({
      email: 'have@x.test',
      displayName: 'Have',
      acceptedConsentVersion: '1',
    });
    await expect(
      signups.submit({ email: 'have@x.test', displayName: 'H' }),
    ).resolves.toBeUndefined();
    await signups.submit({ email: 'new@x.test', displayName: 'N' });
    await expect(
      signups.submit({ email: 'NEW@x.test', displayName: 'N2' }),
    ).resolves.toBeUndefined();
    expect(await store.listSignupRequests()).toHaveLength(1);
  });

  it('caps the number of pending requests', async () => {
    await turnOn();
    for (let i = 0; i < MAX_PENDING_SIGNUP_REQUESTS; i += 1) {
      await store.putSignupRequest({
        id: backend.newId(),
        email: `p${i}@x.test`,
        displayName: 'P',
        message: '',
        status: 'pending',
        createdAt: i,
        decidedAt: null,
      });
    }
    expect(await codeOf(signups.submit({ email: 'late@x.test', displayName: 'L' }))).toBe(
      'conflict',
    );
    // A repeat from someone already waiting is still the neutral answer.
    await expect(signups.submit({ email: 'p1@x.test', displayName: 'P' })).resolves.toBeUndefined();
  });
});

describe('approve and reject', () => {
  it('approve makes a consent-less, non-admin account and a working short code', async () => {
    await turnOn();
    await signups.submit({ email: 'zed@x.test', displayName: 'Zed' });
    const { request, token, expiresAt } = await signups.approve('zed@x.test');
    expect(request.status).toBe('approved');
    expect(request.decidedAt).not.toBeNull();
    expect(token).toMatch(/^[A-Z0-9]{8}$/);
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(await store.getUserByEmail('zed@x.test')).toMatchObject({
      displayName: 'Zed',
      isAdmin: false,
      passwordHash: null,
      consentVersion: '',
    });
    const signedIn = await accounts.redeemMagicLink(token);
    expect(signedIn.needsConsent).toBe(true);
    // Accepting the current notice clears it.
    await accounts.acceptConsent(signedIn.user.id, '1');
    expect(await accounts.needsConsent((await store.getUser(signedIn.user.id))!)).toBe(false);
  });

  it('only acts on pending requests', async () => {
    await turnOn();
    await signups.submit({ email: 'a@x.test', displayName: 'A' });
    await signups.submit({ email: 'b@x.test', displayName: 'B' });
    await signups.approve('a@x.test');
    await signups.reject('b@x.test');
    for (const target of ['a@x.test', 'b@x.test', 'nobody@x.test']) {
      expect(await codeOf(signups.approve(target))).toBe('not_found');
      expect(await codeOf(signups.reject(target))).toBe('not_found');
    }
    expect(await store.getUserByEmail('b@x.test')).toBeUndefined();
  });

  it('refuses to approve when an account appeared for that address meanwhile', async () => {
    await turnOn();
    await signups.submit({ email: 'a@x.test', displayName: 'A' });
    await accounts.register({ email: 'a@x.test', displayName: 'A', acceptedConsentVersion: '1' });
    expect(await codeOf(signups.approve('a@x.test'))).toBe('email_taken');
    expect(await store.listSignupRequests('pending')).toHaveLength(1);
  });
});

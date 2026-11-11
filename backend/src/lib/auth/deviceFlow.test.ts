import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { LINK_CODE_TTL_MINUTES, MINUTE_MS } from '../../consts/index.js';
import { DomainError } from '../errors.js';
import type { Store } from '../store/store.js';
import { openTestBackend } from '../store/testing.js';
import { AccountService } from './accountService.js';
import { hashSecret, normaliseShortCode } from './crypto.js';
import { DeviceFlow } from './deviceFlow.js';

class FakeClock {
  constructor(public time = 1_700_000_000_000) {}
  now = (): number => this.time;
  advance(ms: number): void {
    this.time += ms;
  }
}

const backend = await openTestBackend();
afterAll(() => backend.close());

let store: Store;
let clock: FakeClock;
let accounts: AccountService;
let flow: DeviceFlow;

beforeEach(async () => {
  store = await backend.reset();
  clock = new FakeClock();
  accounts = new AccountService({ store, clock, newId: backend.newId });
  flow = new DeviceFlow({ store, clock, newId: backend.newId, accounts });
});

const signUp = async (name: string) =>
  accounts.register({
    email: `${name}@example.com`,
    displayName: name,
    password: 'correct horse battery',
    acceptedConsentVersion: '1',
  });

const errorCode = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise;
  } catch (e) {
    return e instanceof DomainError ? e.code : 'other';
  }
  return undefined;
};

describe('device requests', () => {
  it('starts pending, then hands the approver’s session over exactly once', async () => {
    const ann = await signUp('ann');
    const started = await flow.start({ deviceLabel: 'Laptop', requestIp: '10.0.0.1' });
    expect(started.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(started.expiresAt).toBe(clock.now() + LINK_CODE_TTL_MINUTES * MINUTE_MS);
    expect(await flow.poll(started.requestId, started.pollSecret)).toEqual({ pending: true });

    await flow.approve(ann.id, started.userCode);
    const done = await flow.poll(started.requestId, started.pollSecret);
    if ('pending' in done) throw new Error('expected a session');
    expect(done.user.id).toBe(ann.id);
    expect(done.sessionToken).toContain('.');
    expect(done.needsConsent).toBe(false);
    expect((await accounts.authenticate(done.sessionToken)).user.id).toBe(ann.id);

    expect(await errorCode(flow.poll(started.requestId, started.pollSecret))).toBe('invalid_token');
  });

  it('never stores the code or the secret in the clear', async () => {
    const started = await flow.start({});
    const row = await store.getDeviceRequest(started.requestId);
    expect(row?.userCodeHash).toBe(hashSecret(normaliseShortCode(started.userCode)));
    expect(row?.pollSecretHash).toBe(hashSecret(started.pollSecret));
    expect(JSON.stringify(row)).not.toContain(started.pollSecret);
    expect(JSON.stringify(row)).not.toContain(normaliseShortCode(started.userCode));
  });

  it('describes a request for the approval screen, tolerating typing', async () => {
    const started = await flow.start({ deviceLabel: 'Laptop', requestIp: '10.0.0.1' });
    const typed = started.userCode.toLowerCase().replace('-', ' ');
    expect(await flow.describe(typed)).toEqual({
      deviceLabel: 'Laptop',
      requestIp: '10.0.0.1',
      createdAt: clock.now(),
    });
    expect(await errorCode(flow.describe('ZZZZ-ZZZZ'))).toBe('invalid_token');
  });

  it('answers a wrong secret, an unknown id and an expiry the same way', async () => {
    const ann = await signUp('ann');
    const started = await flow.start({});
    await flow.approve(ann.id, started.userCode);
    expect(await errorCode(flow.poll(started.requestId, 'wrong'))).toBe('invalid_token');
    expect(await errorCode(flow.poll(backend.newId(), started.pollSecret))).toBe('invalid_token');
    // the wrong-secret attempts did not consume the delivery
    clock.advance(LINK_CODE_TTL_MINUTES * MINUTE_MS + 1);
    expect(await errorCode(flow.poll(started.requestId, started.pollSecret))).toBe('invalid_token');
  });

  it('cannot be polled with the user code alone', async () => {
    const ann = await signUp('ann');
    const started = await flow.start({});
    await flow.approve(ann.id, started.userCode);
    expect(await errorCode(flow.poll(started.requestId, started.userCode))).toBe('invalid_token');
    expect(
      await errorCode(flow.poll(started.requestId, normaliseShortCode(started.userCode))),
    ).toBe('invalid_token');
  });

  it('refuses approval after expiry and a second approval', async () => {
    const ann = await signUp('ann');
    const bob = await signUp('bob');
    const first = await flow.start({});
    await flow.approve(ann.id, first.userCode);
    expect(await errorCode(flow.approve(bob.id, first.userCode))).toBe('invalid_token');

    const second = await flow.start({});
    clock.advance(LINK_CODE_TTL_MINUTES * MINUTE_MS);
    expect(await errorCode(flow.approve(ann.id, second.userCode))).toBe('invalid_token');
  });

  it('keeps the first approver when a second user approves the same code', async () => {
    const ann = await signUp('ann');
    const bob = await signUp('bob');
    const started = await flow.start({});
    const results = await Promise.allSettled([
      flow.approve(ann.id, started.userCode),
      flow.approve(bob.id, started.userCode),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results[0]?.status === 'fulfilled' ? ann : bob;
    expect(await errorCode(flow.approve(ann.id, started.userCode))).toBe('invalid_token');
    const done = await flow.poll(started.requestId, started.pollSecret);
    if ('pending' in done) throw new Error('expected a session');
    expect(done.user.id).toBe(winner.id);
  });

  it('caps labels at 80 characters and strips control characters', async () => {
    const long = await flow.start({ deviceLabel: 'x'.repeat(5000) });
    expect((await store.getDeviceRequest(long.requestId))?.deviceLabel).toBe('x'.repeat(80));
    const dirty = await flow.start({ deviceLabel: 'Des\nk\u0000 PC' });
    expect((await store.getDeviceRequest(dirty.requestId))?.deviceLabel).toBe('Desk PC');
    const plain = await flow.start({ deviceLabel: 'Andy’s laptop' });
    expect((await store.getDeviceRequest(plain.requestId))?.deviceLabel).toBe('Andy’s laptop');
  });

  it('strips invisible formatting and bidi overrides from labels', async () => {
    // RLO would show "PC kseD" reversed; zero-width and isolate characters hide text or reorder it.
    const sneaky = '\u202eDesk\u200b PC\u2066x\u2069\ufeff\u200f\u202a\u200e';
    const started = await flow.start({ deviceLabel: sneaky });
    expect((await store.getDeviceRequest(started.requestId))?.deviceLabel).toBe('Desk PCx');
    const only = await flow.start({ deviceLabel: '\u202e\u200b\u2067' });
    expect((await store.getDeviceRequest(only.requestId))?.deviceLabel).toBeNull();
  });

  it('sweeps expired requests when a new one starts', async () => {
    const old = await flow.start({});
    clock.advance(LINK_CODE_TTL_MINUTES * MINUTE_MS + 1);
    await flow.start({});
    expect(await store.getDeviceRequest(old.requestId)).toBeUndefined();
  });

  it('refuses approval until the approver accepts a changed notice, and keeps the request open', async () => {
    const ann = await signUp('ann');
    await store.putSettings({ ...(await store.getSettings()), consentVersion: '2' });
    const started = await flow.start({});
    expect(await errorCode(flow.approve(ann.id, started.userCode))).toBe('consent_required');
    expect(await flow.poll(started.requestId, started.pollSecret)).toEqual({ pending: true });

    await accounts.acceptConsent(ann.id, '2');
    await flow.approve(ann.id, started.userCode);
    const done = await flow.poll(started.requestId, started.pollSecret);
    if ('pending' in done) throw new Error('expected a session');
    expect(done.needsConsent).toBe(false);
  });

  it('still reports needsConsent if the notice changes between approval and collection', async () => {
    const ann = await signUp('ann');
    const started = await flow.start({});
    await flow.approve(ann.id, started.userCode);
    await store.putSettings({ ...(await store.getSettings()), consentVersion: '2' });
    const done = await flow.poll(started.requestId, started.pollSecret);
    if ('pending' in done) throw new Error('expected a session');
    expect(done.needsConsent).toBe(true);
  });
});

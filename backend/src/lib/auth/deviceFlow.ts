import { randomUUID } from 'node:crypto';

import { LINK_CODE_TTL_MINUTES, MINUTE_MS } from '../../consts/index.js';
import type { DeviceRequest, User } from '../../types/index.js';
import { DomainError } from '../errors.js';
import type { Store } from '../store/store.js';
import type { AccountService, Clock, SignedIn } from './accountService.js';
import { cleanDeviceLabel } from './deviceLabel.js';
import {
  equalHashes,
  generateSecret,
  generateShortCode,
  hashSecret,
  normaliseShortCode,
} from './crypto.js';

export interface DeviceFlowDeps {
  store: Store;
  accounts: AccountService;
  clock?: Clock;
  newId?: () => string;
}

export interface StartedDeviceRequest {
  requestId: string;
  /** Shown on the app's screen, typed or confirmed in a signed-in browser: `ABCD-2345`. */
  userCode: string;
  /** Known only to the app that started the request; needed to collect the session. */
  pollSecret: string;
  expiresAt: number;
}

export type PollResult = { pending: true } | SignedIn;

const MAX_CODE_ATTEMPTS = 5;

/**
 * Sign-in for the desktop app without any form in it: the app asks for a request, shows a short
 * code, and a browser that is already signed in approves that code. The app then collects a
 * session by polling with a secret that only it holds (docs/architecture/APP-SIGN-IN.md).
 *
 * Every failure to look a request up — unknown, expired, wrong secret, already collected — is the
 * same `invalid_token`, so a caller learns nothing about which requests exist.
 */
export class DeviceFlow {
  private readonly store: Store;
  private readonly accounts: AccountService;
  private readonly clock: Clock;
  private readonly newId: () => string;

  constructor(deps: DeviceFlowDeps) {
    this.store = deps.store;
    this.accounts = deps.accounts;
    this.clock = deps.clock ?? { now: () => Date.now() };
    this.newId = deps.newId ?? randomUUID;
  }

  async start(input: {
    deviceLabel?: string | undefined;
    requestIp?: string | undefined;
  }): Promise<StartedDeviceRequest> {
    const now = this.clock.now();
    await this.store.deleteExpiredDeviceRequests(now);

    let code = generateShortCode();
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      if (!(await this.store.getDeviceRequestByCodeHash(hashSecret(code)))) break;
      code = generateShortCode();
    }
    const pollSecret = generateSecret();
    const request: DeviceRequest = {
      id: this.newId(),
      userCodeHash: hashSecret(code),
      pollSecretHash: hashSecret(pollSecret),
      deviceLabel: cleanDeviceLabel(input.deviceLabel) ?? null,
      requestIp: input.requestIp ?? null,
      createdAt: now,
      expiresAt: now + LINK_CODE_TTL_MINUTES * MINUTE_MS,
      approvedUserId: null,
      deliveredAt: null,
    };
    await this.store.putDeviceRequest(request);
    return {
      requestId: request.id,
      userCode: `${code.slice(0, 4)}-${code.slice(4)}`,
      pollSecret,
      expiresAt: request.expiresAt,
    };
  }

  /** What the approval screen shows, so the person can recognise the device before saying yes. */
  async describe(
    userCode: string,
  ): Promise<{ deviceLabel: string | null; requestIp: string | null; createdAt: number }> {
    const request = await this.openByCode(userCode);
    return {
      deviceLabel: request.deviceLabel,
      requestIp: request.requestIp,
      createdAt: request.createdAt,
    };
  }

  /** The signed-in user says "yes, that is my app". The caller has already authenticated them. */
  async approve(userId: string, userCode: string): Promise<void> {
    const approver = await this.store.getUser(userId);
    if (!approver) throw new DomainError('invalid_input', 'unknown user');
    // The app never shows the notice, so a stale acceptance would only fail later at the poll.
    await this.accounts.requireCurrentConsent(approver);
    const request = await this.openByCode(userCode);
    // Conditional in the store, so two approvals racing (or a later one) cannot overwrite the first.
    if (!(await this.store.markDeviceRequestApproved(request.id, userId, this.clock.now()))) {
      throw new DomainError('invalid_token');
    }
  }

  /** The app asks whether it has been approved. A session is handed over once, then never again. */
  async poll(requestId: string, pollSecret: string): Promise<PollResult> {
    const request = await this.store.getDeviceRequest(requestId);
    if (
      !request ||
      !equalHashes(request.pollSecretHash, hashSecret(pollSecret)) ||
      request.expiresAt <= this.clock.now() ||
      request.deliveredAt !== null
    ) {
      throw new DomainError('invalid_token');
    }
    if (request.approvedUserId === null) return { pending: true };

    if (!(await this.store.markDeviceRequestDelivered(request.id, this.clock.now()))) {
      throw new DomainError('invalid_token');
    }
    // Known limit: if creating the session fails after delivery is marked, the delivery is spent
    // and the app must start a new request (deliberate; the alternative risks delivering twice).
    const user: User | undefined = await this.store.getUser(request.approvedUserId);
    if (!user) throw new DomainError('invalid_token');
    return this.accounts.signInUser(user, request.deviceLabel ?? undefined);
  }

  /** A live, not-yet-approved request for this code, or `invalid_token`. */
  private async openByCode(userCode: string): Promise<DeviceRequest> {
    const request = await this.store.getDeviceRequestByCodeHash(
      hashSecret(normaliseShortCode(userCode)),
    );
    if (!request || request.expiresAt <= this.clock.now() || request.approvedUserId !== null) {
      throw new DomainError('invalid_token');
    }
    return request;
  }
}

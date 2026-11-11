import { randomUUID } from 'node:crypto';

import { MAX_PENDING_SIGNUP_REQUESTS } from '../../consts/index.js';
import type { SignupRequest, SignupRequestStatus, User } from '../../types/index.js';
import { DomainError } from '../errors.js';
import type { Store } from '../store/store.js';
import type { AccountService, Clock } from './accountService.js';
import { stripUnshowable } from './deviceLabel.js';

export interface SignupDeps {
  store: Store;
  accounts: AccountService;
  clock?: Clock;
  newId?: () => string;
}

export interface SubmitInput {
  email: string;
  displayName: string;
  message?: string;
}

const MAX_MESSAGE = 500;

const normaliseEmail = (email: string): string => email.trim().toLowerCase();
const validEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

/**
 * Visitor sign-up requests: a stranger asks, the operator decides in the Admin CLI. Off unless the
 * `signup.requests` setting is on. Approving makes the account (no password, recording notice NOT
 * accepted on the person's behalf, never Admin) and issues a one-time code for the operator to hand
 * over on a side channel; the person accepts the notice at their first sign-in.
 */
export class SignupService {
  private readonly store: Store;
  private readonly accounts: AccountService;
  private readonly clock: Clock;
  private readonly newId: () => string;

  constructor(deps: SignupDeps) {
    this.store = deps.store;
    this.accounts = deps.accounts;
    this.clock = deps.clock ?? { now: () => Date.now() };
    this.newId = deps.newId ?? randomUUID;
  }

  async enabled(): Promise<boolean> {
    return (await this.store.getSettings()).signupRequests === 'on';
  }

  /**
   * Records a request. Returns nothing either way: an address that already has an account or a
   * pending request is silently ignored, so the public endpoint cannot be used to find out who has
   * an account here.
   */
  async submit(input: SubmitInput): Promise<void> {
    if (!(await this.enabled())) throw new DomainError('not_found');

    const email = normaliseEmail(stripUnshowable(input.email));
    const displayName = stripUnshowable(input.displayName);
    const message = stripUnshowable(input.message ?? '', true);
    if (!validEmail(email)) throw new DomainError('invalid_input', 'invalid email address');
    if (displayName.length === 0 || [...displayName].length > 80) {
      throw new DomainError('invalid_input', 'a name is required (at most 80 characters)');
    }
    if ([...message].length > MAX_MESSAGE) {
      throw new DomainError(
        'invalid_input',
        `the message can be at most ${MAX_MESSAGE} characters`,
      );
    }

    if (await this.store.getUserByEmail(email)) return;
    const pending = await this.store.listSignupRequests('pending');
    if (pending.some((r) => r.email === email)) return;
    if (pending.length >= MAX_PENDING_SIGNUP_REQUESTS) {
      throw new DomainError('conflict', 'too many requests are waiting; try again later');
    }
    await this.store.putSignupRequest({
      id: this.newId(),
      email,
      displayName,
      message,
      status: 'pending',
      createdAt: this.clock.now(),
      decidedAt: null,
    });
  }

  list(status: SignupRequestStatus = 'pending'): Promise<SignupRequest[]> {
    return this.store.listSignupRequests(status);
  }

  /** Creates the account and a short sign-in code for it. Only acts on a pending request. */
  async approve(
    idOrEmail: string,
  ): Promise<{ request: SignupRequest; token: string; expiresAt: number }> {
    const request = await this.findPending(idOrEmail);
    if (await this.store.getUserByEmail(request.email)) {
      throw new DomainError('email_taken', `${request.email} already has an account`);
    }
    const now = this.clock.now();
    const user: User = {
      id: this.newId(),
      email: request.email,
      displayName: request.displayName,
      passwordHash: null,
      isAdmin: false,
      // Not accepted: this matches no real notice version, so the first sign-in asks.
      consentVersion: '',
      consentAt: 0,
      createdAt: now,
    };
    await this.store.putUser(user);
    const issued = await this.accounts.requestMagicLink(user.email, 'signin', { short: true });
    if (!issued) throw new DomainError('conflict', 'could not issue a code');
    const decided: SignupRequest = { ...request, status: 'approved', decidedAt: now };
    await this.store.putSignupRequest(decided);
    return { request: decided, ...issued };
  }

  async reject(idOrEmail: string): Promise<SignupRequest> {
    const request = await this.findPending(idOrEmail);
    const decided: SignupRequest = {
      ...request,
      status: 'rejected',
      decidedAt: this.clock.now(),
    };
    await this.store.putSignupRequest(decided);
    return decided;
  }

  private async findPending(idOrEmail: string): Promise<SignupRequest> {
    const key = idOrEmail.trim().toLowerCase();
    const pending = await this.store.listSignupRequests('pending');
    const found = pending.find((r) => r.id === key || r.email === key);
    if (!found) throw new DomainError('not_found', `no pending request for "${idOrEmail}"`);
    return found;
  }
}

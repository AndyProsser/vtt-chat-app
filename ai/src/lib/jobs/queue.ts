import { randomUUID } from 'node:crypto';

import type { Job } from '../../types/index.js';

export interface EnqueueInput {
  kind: string;
  recordingId?: string;
  maxAttempts?: number;
}

/**
 * A durable queue of retryable jobs. Postgres is the real one (`jobs` table); the in-memory one
 * backs the tests. Contract, shared by both (queue.contract.test.ts):
 *
 * - `enqueue` returns the existing queued/running job for the same kind + recording instead of
 *   adding a duplicate, so "recording stopped" arriving twice cannot process it twice.
 * - `claim` takes a queued job that is due, **or a running one whose lease expired** (its worker
 *   died), **or a running one this same `workerId` holds** (the worker restarted and its own job is
 *   orphaned, so it need not wait out the lease; leases held by other ids are still honoured). Each claim counts as an attempt; a job that has used all its attempts is failed rather
 *   than claimed again, so a job that crashes its worker cannot loop forever.
 * - A running job keeps its lease with `extendLease`; a long transcription must heartbeat.
 * - **One table's sessions are processed in order.** A `process-recording` job is not claimed while an earlier
 *   session of the same campaign (by when it started recording) has a job that is queued, running or failed.
 *   A failed one holds the rest back until it is retried, or the operator `release`s it. (Reprocessing the
 *   earliest session is never held back, and other kinds of job are never ordered.)
 */
export interface JobQueue {
  enqueue(input: EnqueueInput, now: number): Promise<Job>;
  claim(now: number, leaseMs: number, workerId?: string): Promise<Job | undefined>;
  extendLease(id: string, now: number, leaseMs: number): Promise<void>;
  complete(id: string, now: number): Promise<void>;
  /** Back to queued at `retryAt`, or failed for good if no attempts remain. Returns the new state. */
  fail(id: string, error: string, now: number, retryAt: number): Promise<Job>;
  /** Puts a failed job back in the queue with a fresh set of attempts (Admin CLI). */
  retry(id: string, now: number): Promise<Job | undefined>;
  /**
   * The operator's override: a failed job no longer holds later sessions of its table back. Returns the job,
   * or undefined if there is no failed job with that id.
   */
  release(id: string): Promise<Job | undefined>;
  /** The earlier session's job holding this one back, if any (for `jobs list`). */
  blockedBy(id: string): Promise<Job | undefined>;
  get(id: string): Promise<Job | undefined>;
  list(states?: Job['state'][]): Promise<Job[]>;
}

const ACTIVE = new Set<Job['state']>(['queued', 'running']);
/** The only kind of job that is ordered within a table. */
export const ORDERED_JOB_KIND = 'process-recording';
/** A job in one of these states holds later sessions of its table back (unless released). */
const HOLDS = new Set<Job['state']>(['queued', 'running', 'failed']);

/** Where a recording belongs and when it started: what the order rule needs to know about a job's recording. */
export interface SessionOf {
  (recordingId: string): { campaignId: string; startedAt: number } | undefined;
}

export class MemoryJobQueue implements JobQueue {
  readonly jobs = new Map<string, Job>();
  /**
   * `sessionOf` tells the queue which campaign a recording is in and when it started, so it can order a table's
   * sessions. Without it (a bare queue in a test) nothing is ordered.
   */
  constructor(
    private readonly newId: () => string = randomUUID,
    private readonly sessionOf?: SessionOf,
  ) {}

  private holdingBack(job: Job): Job | undefined {
    if (!this.sessionOf || job.kind !== ORDERED_JOB_KIND || !job.recordingId) return undefined;
    const mine = this.sessionOf(job.recordingId);
    if (!mine) return undefined;
    let earliest: { job: Job; startedAt: number } | undefined;
    for (const other of this.jobs.values()) {
      if (other.id === job.id || other.kind !== ORDERED_JOB_KIND || !other.recordingId) continue;
      if (!HOLDS.has(other.state) || other.released) continue;
      const theirs = this.sessionOf(other.recordingId);
      if (!theirs || theirs.campaignId !== mine.campaignId) continue;
      const earlier =
        theirs.startedAt < mine.startedAt ||
        (theirs.startedAt === mine.startedAt && other.recordingId < job.recordingId);
      if (earlier && (!earliest || theirs.startedAt < earliest.startedAt))
        earliest = { job: other, startedAt: theirs.startedAt };
    }
    return earliest?.job;
  }

  async enqueue(input: EnqueueInput, now: number): Promise<Job> {
    const existing = [...this.jobs.values()].find(
      (j) =>
        j.kind === input.kind &&
        j.recordingId === (input.recordingId ?? null) &&
        ACTIVE.has(j.state),
    );
    if (existing) return { ...existing };
    const job: Job = {
      id: this.newId(),
      kind: input.kind,
      recordingId: input.recordingId ?? null,
      state: 'queued',
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
      runAfter: now,
      lockedUntil: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    return { ...job };
  }

  async claim(now: number, leaseMs: number, workerId?: string): Promise<Job | undefined> {
    const orphaned = (j: Job): boolean =>
      j.state === 'running' &&
      ((j.lockedUntil ?? 0) <= now || (workerId !== undefined && j.lockedBy === workerId));
    // A worker that died mid-job and used its last attempt: give up on it.
    for (const j of this.jobs.values()) {
      if (orphaned(j) && j.attempts >= j.maxAttempts) {
        j.state = 'failed';
        j.lastError ??= 'worker stopped responding on the final attempt';
        j.lockedUntil = null;
        j.updatedAt = now;
      }
    }
    const due = [...this.jobs.values()]
      .filter(
        (j) => (j.state === 'queued' && j.runAfter <= now && !this.holdingBack(j)) || orphaned(j),
      )
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!due) return undefined;
    due.state = 'running';
    due.attempts += 1;
    due.lockedUntil = now + leaseMs;
    due.lockedBy = workerId ?? null;
    due.updatedAt = now;
    return { ...due };
  }

  async extendLease(id: string, now: number, leaseMs: number): Promise<void> {
    const j = this.jobs.get(id);
    if (j?.state === 'running') {
      j.lockedUntil = now + leaseMs;
      j.updatedAt = now;
    }
  }

  async complete(id: string, now: number): Promise<void> {
    const j = this.jobs.get(id);
    if (j) Object.assign(j, { state: 'done', lockedUntil: null, lastError: null, updatedAt: now });
  }

  async fail(id: string, error: string, now: number, retryAt: number): Promise<Job> {
    const j = this.jobs.get(id);
    if (!j) throw new Error(`no job ${id}`);
    j.lastError = error;
    j.lockedUntil = null;
    j.updatedAt = now;
    if (j.attempts >= j.maxAttempts) j.state = 'failed';
    else Object.assign(j, { state: 'queued', runAfter: retryAt });
    return { ...j };
  }

  async release(id: string): Promise<Job | undefined> {
    const j = this.jobs.get(id);
    if (j?.state !== 'failed') return undefined;
    j.released = true;
    return { ...j };
  }

  async blockedBy(id: string): Promise<Job | undefined> {
    const j = this.jobs.get(id);
    const blocker = j ? this.holdingBack(j) : undefined;
    return blocker ? { ...blocker } : undefined;
  }

  async retry(id: string, now: number): Promise<Job | undefined> {
    const j = this.jobs.get(id);
    if (j?.state !== 'failed') return undefined;
    Object.assign(j, {
      state: 'queued',
      attempts: 0,
      runAfter: now,
      lastError: null,
      released: false,
      updatedAt: now,
    });
    return { ...j };
  }

  get = async (id: string) => {
    const j = this.jobs.get(id);
    return j ? { ...j } : undefined;
  };

  list = async (states?: Job['state'][]) =>
    [...this.jobs.values()]
      .filter((j) => !states || states.includes(j.state))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((j) => ({ ...j }));
}

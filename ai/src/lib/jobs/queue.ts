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
 *   died). Each claim counts as an attempt; a job that has used all its attempts is failed rather
 *   than claimed again, so a job that crashes its worker cannot loop forever.
 * - A running job keeps its lease with `extendLease`; a long transcription must heartbeat.
 */
export interface JobQueue {
  enqueue(input: EnqueueInput, now: number): Promise<Job>;
  claim(now: number, leaseMs: number): Promise<Job | undefined>;
  extendLease(id: string, now: number, leaseMs: number): Promise<void>;
  complete(id: string, now: number): Promise<void>;
  /** Back to queued at `retryAt`, or failed for good if no attempts remain. Returns the new state. */
  fail(id: string, error: string, now: number, retryAt: number): Promise<Job>;
  /** Puts a failed job back in the queue with a fresh set of attempts (Admin CLI). */
  retry(id: string, now: number): Promise<Job | undefined>;
  get(id: string): Promise<Job | undefined>;
  list(states?: Job['state'][]): Promise<Job[]>;
}

const ACTIVE = new Set<Job['state']>(['queued', 'running']);

export class MemoryJobQueue implements JobQueue {
  readonly jobs = new Map<string, Job>();
  constructor(private readonly newId: () => string = randomUUID) {}

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

  async claim(now: number, leaseMs: number): Promise<Job | undefined> {
    // A worker that died mid-job and used its last attempt: give up on it.
    for (const j of this.jobs.values()) {
      if (j.state === 'running' && (j.lockedUntil ?? 0) <= now && j.attempts >= j.maxAttempts) {
        j.state = 'failed';
        j.lastError ??= 'worker stopped responding on the final attempt';
        j.lockedUntil = null;
        j.updatedAt = now;
      }
    }
    const due = [...this.jobs.values()]
      .filter(
        (j) =>
          (j.state === 'queued' && j.runAfter <= now) ||
          (j.state === 'running' && (j.lockedUntil ?? 0) <= now),
      )
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!due) return undefined;
    due.state = 'running';
    due.attempts += 1;
    due.lockedUntil = now + leaseMs;
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

  async retry(id: string, now: number): Promise<Job | undefined> {
    const j = this.jobs.get(id);
    if (j?.state !== 'failed') return undefined;
    Object.assign(j, {
      state: 'queued',
      attempts: 0,
      runAfter: now,
      lastError: null,
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

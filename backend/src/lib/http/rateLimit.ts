/**
 * A small fixed-window limiter, kept in memory. Enough to stop online password guessing and
 * magic-link/invite-code spraying on a single-node homelab instance; it resets on restart, which
 * is acceptable for that threat. A multi-node deployment would move this to Redis.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; windowEnds: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records an attempt and returns `true` if it is allowed. */
  allow(key: string): boolean {
    const now = this.now();
    const entry = this.hits.get(key);
    if (!entry || entry.windowEnds <= now) {
      this.hits.set(key, { count: 1, windowEnds: now + this.windowMs });
      this.prune(now);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  /** Forget a key, e.g. after a successful sign-in. */
  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Drops expired windows so a stream of one-off keys can't grow the map without bound. */
  private prune(now: number): void {
    if (this.hits.size < 1_000) return;
    for (const [key, entry] of this.hits) {
      if (entry.windowEnds <= now) this.hits.delete(key);
    }
  }
}

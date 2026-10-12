/**
 * Where the counters live, behind an interface, because the answer changes
 * with the deployment shape.
 *
 * ── What a store must provide ────────────────────────────────────────────────
 *
 * Two primitives. `consume` is a fixed-window counter: the first hit on a key
 * opens a window, every hit in it increments, and the result says whether the
 * hit was within the limit and when the window ends. The count is incremented
 * past the limit on purpose — the caller needs to know that this is the 1st or
 * the 100th refusal, because that decides whether to write an audit entry
 * (rate-limit.service.ts). `acquire`/`release` is a slot counter for work in
 * flight, used for uploads and downloads where the cost is the concurrency,
 * not the count.
 *
 * ── Slots are leases ─────────────────────────────────────────────────────────
 *
 * A slot is taken with a time to live and expires on its own. The release
 * that should free it runs when the response closes, and that is reliable
 * for every ending Node reports — a finished response, a dropped socket — but
 * "reliable" is a claim about a code path, and the primary device is an iPad
 * on office wifi. Dropped uploads will be routine. If any ending ever fails
 * to release, a per-process cap of twenty is twenty leaks away from refusing
 * every firm's uploads until a restart. The lease is the backstop: a leaked
 * slot heals when its TTL runs out, with nobody involved.
 *
 * The TTL has to exceed the longest legitimate hold, or a slow upload would
 * lose its slot while still in progress and the next caller would be let in
 * over the cap. policy.ts sets it from the slowest link a 50 MB upload has to
 * survive.
 *
 * Both are async so that a shared store fits the same signature. The memory
 * implementation below resolves immediately.
 *
 * ── The memory store, and what breaks with two instances ─────────────────────
 *
 * `MemoryRateLimitStore` is per process. Two API instances behind a load
 * balancer each hold the full quota, so every limit silently doubles, and
 * because the balancer spreads one client's requests across both, each sees
 * roughly half the traffic and neither trips. A restart clears every counter
 * and every in-flight slot. It is the right store for the single-instance
 * pilot and the wrong one for anything after it; see ADR 0007.
 *
 * A Redis store would be the same two operations: `consume` as `INCR` plus
 * `PEXPIRE` on first hit (or one Lua script, so the two cannot be split by a
 * crash), and `acquire` as a sorted set per key whose members are lease ids
 * scored by expiry — trim everything expired, count, add — with `release` as
 * `ZREM` of that one member. The same TTL has to hold there: a process that
 * dies holding a slot must not hold it forever, and the score on each lease
 * is what guarantees that, not a cleanup job. Nothing in the service would
 * change.
 */

export interface ConsumeResult {
  /** True when this hit was within the limit. */
  allowed: boolean;
  /** Hits in the current window, this one included — may exceed the limit. */
  count: number;
  /** Epoch milliseconds at which the window ends. */
  resetAt: number;
}

export interface RateLimitStore {
  consume(
    key: string,
    limit: number,
    windowMs: number,
    now: number,
  ): Promise<ConsumeResult>;

  /**
   * Takes one slot under `key` if fewer than `max` unexpired leases are held,
   * returning the lease's id — or undefined if the key is full. The lease
   * expires at `now + ttlMs` whether or not it is released.
   */
  acquire(
    key: string,
    max: number,
    ttlMs: number,
    now: number,
  ): Promise<string | undefined>;

  /**
   * Gives that one lease back. A lease must know whose it is: releasing by
   * key alone would free whichever lease happened to be there, and a stale
   * release — for a lease that already expired and whose slot someone else
   * now holds — would then admit a caller over the cap. Releasing a lease
   * that has expired or was never held does nothing.
   */
  release(key: string, leaseId: string, now: number): Promise<void>;
}

interface Window {
  count: number;
  resetAt: number;
}

/** Bounds memory against an attacker rotating keys to grow the map. */
const MAX_TRACKED_KEYS = 100_000;

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, Window>();
  /** Per key, each held lease's id and expiry. */
  private readonly leases = new Map<string, Map<string, number>>();
  private nextLease = 0;

  async consume(
    key: string,
    limit: number,
    windowMs: number,
    now: number,
  ): Promise<ConsumeResult> {
    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      if (this.windows.size >= MAX_TRACKED_KEYS) {
        this.prune(now);
      }
      const window = { count: 1, resetAt: now + windowMs };
      this.windows.set(key, window);
      return { allowed: limit >= 1, count: 1, resetAt: window.resetAt };
    }

    existing.count += 1;
    return {
      allowed: existing.count <= limit,
      count: existing.count,
      resetAt: existing.resetAt,
    };
  }

  async acquire(
    key: string,
    max: number,
    ttlMs: number,
    now: number,
  ): Promise<string | undefined> {
    const live = this.liveLeases(key, now);

    if (live.size >= max) {
      return undefined;
    }

    this.nextLease += 1;
    const leaseId = `${now}-${this.nextLease}`;
    live.set(leaseId, now + ttlMs);
    this.leases.set(key, live);
    return leaseId;
  }

  async release(key: string, leaseId: string, now: number): Promise<void> {
    const live = this.liveLeases(key, now);
    // Expired leases were dropped above, so a stale release finds nothing.
    live.delete(leaseId);

    if (live.size === 0) {
      this.leases.delete(key);
    } else {
      this.leases.set(key, live);
    }
  }

  /** The unexpired leases under a key, dropping the rest as it goes. */
  private liveLeases(key: string, now: number): Map<string, number> {
    const held = this.leases.get(key);
    if (!held) return new Map();
    return new Map([...held].filter(([, expiresAt]) => expiresAt > now));
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key);
      }
    }

    // Everything is still live: drop the oldest rather than grow without bound.
    if (this.windows.size >= MAX_TRACKED_KEYS) {
      const excess = this.windows.size - Math.floor(MAX_TRACKED_KEYS / 2);
      let removed = 0;
      for (const key of this.windows.keys()) {
        if (removed >= excess) break;
        this.windows.delete(key);
        removed += 1;
      }
    }
  }
}

export const RATE_LIMIT_STORE = Symbol("legal.rate-limit-store");

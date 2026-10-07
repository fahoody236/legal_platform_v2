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
 * crash), and `acquire` as `INCR` with a ceiling check and a TTL as the
 * safety net for a process that died holding a slot. Nothing in the service
 * would change.
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

  /** Takes one slot under `key` if fewer than `max` are held; says whether it did. */
  acquire(key: string, max: number): Promise<boolean>;

  /** Gives a slot back. Never goes below zero. */
  release(key: string): Promise<void>;
}

interface Window {
  count: number;
  resetAt: number;
}

/** Bounds memory against an attacker rotating keys to grow the map. */
const MAX_TRACKED_KEYS = 100_000;

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, Window>();
  private readonly slots = new Map<string, number>();

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

  async acquire(key: string, max: number): Promise<boolean> {
    const held = this.slots.get(key) ?? 0;

    if (held >= max) {
      return false;
    }

    this.slots.set(key, held + 1);
    return true;
  }

  async release(key: string): Promise<void> {
    const held = this.slots.get(key) ?? 0;

    if (held <= 1) {
      this.slots.delete(key);
    } else {
      this.slots.set(key, held - 1);
    }
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

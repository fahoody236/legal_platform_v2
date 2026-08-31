import { Injectable } from "@nestjs/common";

/**
 * Fixed-window counters for sign-in attempts, keyed two ways.
 *
 * Per address, because one host running a credential-stuffing list is the
 * common case. Per email, because a distributed attacker spreads the same
 * account across many addresses and would otherwise stay under the per-IP limit
 * indefinitely. Neither alone is enough; either alone is easy to route around.
 *
 * Both counters are consumed before the account exists or does not — the limit
 * applies to the submitted address whether or not it belongs to anyone, so a
 * 429 discloses nothing about who has an account here. This sits in front of
 * the per-credential lockout in the database rather than replacing it: that one
 * survives a restart and follows the account; this one is cheap and stops the
 * traffic before it reaches Argon2, which is a deliberately expensive function
 * and therefore a denial-of-service lever in its own right.
 *
 * ── Limitation, stated plainly ───────────────────────────────────────────────
 *
 * This is per-process memory. Two instances behind a load balancer each allow
 * the full quota, so the effective limit multiplies by the instance count, and
 * a restart clears every counter. Adequate for a single-instance pilot; it must
 * move to shared storage before the API is scaled horizontally, and that is a
 * change to make deliberately rather than to discover.
 *
 * The per-email limit also gives an attacker a way to keep a known user out for
 * the window length. That is the same trade-off the account lockout makes, and
 * the window is short for that reason.
 */

interface Window {
  count: number;
  resetAt: number;
}

const IP_LIMIT = 20;
const EMAIL_LIMIT = 10;
const WINDOW_MS = 15 * 60 * 1000;

/** Bounds memory against an attacker rotating keys to grow the map. */
const MAX_TRACKED_KEYS = 50_000;

class FixedWindowCounter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns false when the caller has exhausted its quota for this window. */
  consume(key: string, now: number): boolean {
    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      if (this.windows.size >= MAX_TRACKED_KEYS) {
        this.prune(now);
      }
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (existing.count >= this.limit) {
      return false;
    }

    existing.count += 1;
    return true;
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

@Injectable()
export class LoginRateLimiter {
  private readonly byIp = new FixedWindowCounter(IP_LIMIT, WINDOW_MS);
  private readonly byEmail = new FixedWindowCounter(EMAIL_LIMIT, WINDOW_MS);

  /**
   * Both counters are consumed on every call, never short-circuited. Stopping
   * at the first rejection would leave the second counter under-counting an
   * attacker who trips the first one, so a client that switches address mid-run
   * would find its per-email budget intact.
   */
  allow(ip: string, email: string): boolean {
    const now = Date.now();
    const ipAllowed = this.byIp.consume(ip, now);
    const emailAllowed = this.byEmail.consume(
      email.trim().toLowerCase(),
      now,
    );

    return ipAllowed && emailAllowed;
  }
}

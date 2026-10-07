/**
 * The limits, as data. ADR 0007 has the reasoning behind each number; the
 * fact that drives most of them is that the pilot firm is about thirty people
 * behind one office address.
 *
 * ── Classes ──────────────────────────────────────────────────────────────────
 *
 * A route declares a class with `@RateLimit("…")`. A route that declares
 * nothing gets `read`: absent means limited, not unlimited, which is the same
 * rule the permission guard applies to absent metadata. `exempt` exists so
 * that opting out is a declaration review can see, and only /health makes it.
 *
 * ── Scopes ───────────────────────────────────────────────────────────────────
 *
 * `ip` and `email` are for public routes, where nothing else identifies the
 * caller. `user` and `firm` are for authenticated ones: the firm rule sits
 * above the user rule so that one firm, however many people it has, cannot
 * take the whole instance from the others. On a public route — or an
 * authenticated route reached without a session, which should not happen but
 * costs nothing to cover — a `user` rule falls back to keying by address.
 *
 * ── Nested rules, and what a refusal costs ───────────────────────────────────
 *
 * A class's rules are listed narrow to wide — user before firm, hour before
 * day — and consumption stops at the first refusal. A request the user rule
 * refuses therefore costs the firm nothing. The alternative, consuming every
 * rule on every call, turns one runaway script into an outage for its
 * colleagues: 2,000 requests a minute from one stolen session would exhaust
 * the firm's 1,500 and refuse the other twenty-nine people, which is the
 * exact failure the per-user rule exists to prevent.
 *
 * `auth` is the one class that consumes everything, and says so with
 * `consumeAll`. Its two rules are not nested but independent — the address
 * and the submitted email — and stopping at the first refusal would let a
 * caller who has tripped the address rule keep the email budget intact by
 * switching address. That is the property the sign-in limiter always had.
 *
 * ── Windows ──────────────────────────────────────────────────────────────────
 *
 * Fixed, opened by the first hit. A fixed window admits up to twice the limit
 * across a boundary; a sliding one would not, and would cost a sorted set per
 * key. For limits meant to catch a flood or a script rather than meter fair
 * use, the simpler one is enough.
 */

export const LIMIT_CLASSES = [
  "auth",
  "invitation-lookup",
  "invitation-accept",
  "read",
  "write",
  "search",
  "invite",
  "upload",
  "download",
  "exempt",
] as const;

export type LimitClass = (typeof LIMIT_CLASSES)[number];

export type Scope = "ip" | "email" | "user" | "firm";

export type WindowName = "minute" | "quarter-hour" | "hour" | "day";

export interface Rule {
  scope: Scope;
  limit: number;
  window: WindowName;
}

export interface Concurrency {
  user?: number;
  firm?: number;
  /** Across every caller on this instance. */
  process?: number;
}

export interface Policy {
  /** Narrow to wide. Consumption stops at the first refusal unless `consumeAll`. */
  rules: Rule[];
  /** Consume every rule on every call, refused or not. Only for independent dimensions. */
  consumeAll?: boolean;
  concurrency?: Concurrency;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const WINDOW_MS: Record<WindowName, number> = {
  minute: MINUTE,
  "quarter-hour": 15 * MINUTE,
  hour: HOUR,
  day: 24 * HOUR,
};

export const POLICIES: Record<LimitClass, Policy> = {
  // Per address high enough for an office signing in together at nine; per
  // email as before, since one account under a distributed attack is still
  // one account. Both counters are consumed on every attempt, whether or not
  // the email belongs to anyone — the schedule of refusals is the same for a
  // real account and an invented one.
  auth: {
    rules: [
      { scope: "ip", limit: 100, window: "quarter-hour" },
      { scope: "email", limit: 10, window: "quarter-hour" },
    ],
    consumeAll: true,
  },

  // The token's 256 bits are the control; these counts only bound the reads
  // a scan can cause. Fifteen new colleagues opening links from one office
  // has to fit, and does.
  "invitation-lookup": {
    rules: [{ scope: "ip", limit: 60, window: "quarter-hour" }],
  },
  "invitation-accept": {
    rules: [{ scope: "ip", limit: 40, window: "quarter-hour" }],
  },

  read: {
    rules: [
      { scope: "user", limit: 120, window: "minute" },
      { scope: "firm", limit: 1500, window: "minute" },
    ],
  },

  write: {
    rules: [
      { scope: "user", limit: 30, window: "minute" },
      { scope: "firm", limit: 300, window: "minute" },
    ],
  },

  // Typing with the interface's debounce is three to six requests a query.
  search: {
    rules: [
      { scope: "user", limit: 60, window: "minute" },
      { scope: "firm", limit: 600, window: "minute" },
    ],
  },

  // Creating a user and resending an invitation: the outbound-mail path once
  // a transport exists, and the firm's sending reputation with it.
  invite: {
    rules: [
      { scope: "user", limit: 30, window: "hour" },
      { scope: "firm", limit: 60, window: "hour" },
    ],
  },

  // Counts sized for a firm loading its existing files on day one. The
  // concurrency caps are the real protection: an upload is a stream to disk
  // now, but still a hash, a parse and a write per file in flight.
  upload: {
    rules: [
      { scope: "user", limit: 300, window: "hour" },
      { scope: "firm", limit: 1500, window: "hour" },
    ],
    concurrency: { user: 2, firm: 8, process: 20 },
  },

  // Hourly alone would allow 2,400 a day; the daily ceiling is what makes a
  // departing employee's bulk download slow as well as loud. Its refusals
  // are audited under a distinct action so the two are never confused.
  download: {
    rules: [
      { scope: "user", limit: 100, window: "hour" },
      { scope: "user", limit: 500, window: "day" },
      { scope: "firm", limit: 1000, window: "hour" },
    ],
    concurrency: { user: 3 },
  },

  exempt: { rules: [] },
};

/**
 * The two address-level rules that sit outside the classes.
 *
 * `flood` runs before the tenant middleware, so before the first database
 * call, and is loose because a thirty-person office is one address. Its job
 * is the flood and the anonymous scanner, not fair use.
 *
 * `unauthenticated` counts requests to authenticated routes that end 401 — no
 * cookie, or an invalid one — and is consumed only on that failure path. So a
 * blocked address can still sign in, still use an invitation, still reach
 * /health, and every request carrying a valid session still goes through: it
 * is the failures that are refused, not the address. Six hundred allows an
 * office's expired tabs to all notice at once.
 */
export const FLOOD_RULE: Rule = { scope: "ip", limit: 1000, window: "minute" };
export const UNAUTHENTICATED_RULE: Rule = {
  scope: "ip",
  limit: 600,
  window: "quarter-hour",
};

export const DEFAULT_CLASS: LimitClass = "read";

/** Seconds to tell a refused caller to wait before trying a concurrency slot again. */
export const CONCURRENCY_RETRY_AFTER_SECONDS = 5;

/**
 * Which refusals are audited: the first in a window, then every hundredth.
 * A flood of ten thousand becomes a hundred rows, each saying how many came
 * before it, rather than ten thousand rows saying nothing new.
 */
export function shouldAuditRefusal(refusalNumber: number): boolean {
  return refusalNumber === 1 || refusalNumber % 100 === 0;
}

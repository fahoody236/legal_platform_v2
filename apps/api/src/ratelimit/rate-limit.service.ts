import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import {
  CONCURRENCY_RETRY_AFTER_SECONDS,
  FLOOD_RULE,
  POLICIES,
  UNAUTHENTICATED_RULE,
  WINDOW_MS,
  shouldAuditRefusal,
  type LimitClass,
  type Rule,
  type Scope,
} from "./policy.js";
import { RATE_LIMIT_STORE, type RateLimitStore } from "./rate-limit-store.js";

/** Who the request is from, as far as the limiter needs to know. */
export interface Caller {
  address: string;
  firmId?: string | undefined;
  userId?: string | undefined;
  /** Only the sign-in route has one; consumed as submitted, existing or not. */
  email?: string | undefined;
}

export type Decision =
  | { allowed: true }
  | {
      allowed: false;
      retryAfterSeconds: number;
      /** Which rule refused: for the audit entry and the log. */
      scope: Scope | "concurrency";
      window: Rule["window"] | "concurrent";
      /** 1 for the first refusal in this window, 2 for the next, and so on. */
      refusalNumber: number;
    };

/**
 * What a refusal looks like when recorded. `ip` is the only identity on a
 * public-route refusal; `actorUserId` is set when there was a session.
 */
export interface RefusalRecord {
  firmId: string;
  actorUserId: string | null;
  ip: string;
  action: "ratelimit.refused" | "ratelimit.refused_daily";
  detail: Record<string, unknown>;
}

/**
 * The audit side of a refusal, as an interface, because a refused request has
 * no transaction of its own to record into — the limiter runs before the
 * handler — and because the unit tests for the limiter should not need a
 * database to assert that the hundredth refusal is written and the ninety-
 * ninth is not.
 */
export interface RefusalAudit {
  record(refusal: RefusalRecord): Promise<void>;
}

export const REFUSAL_AUDIT = Symbol("legal.refusal-audit");
export const CLOCK = Symbol("legal.clock");

export type Clock = () => number;

/**
 * One limiter for the whole API.
 *
 * Every rule of a class is consumed on every call, never short-circuited at
 * the first refusal. Stopping early would leave the later counters
 * under-counting a caller who trips an earlier one, so an attacker who
 * switches address mid-run would find the per-email budget intact. That is
 * the property the sign-in limiter had, kept.
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly now: Clock;

  constructor(
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
    @Inject(REFUSAL_AUDIT) private readonly audit: RefusalAudit,
    @Optional() @Inject(CLOCK) clock?: Clock,
  ) {
    this.now = clock ?? Date.now;
  }

  /**
   * Consumes every rule of the class for this caller and returns the first
   * refusal, if any. Refusals are audited here, capped, when a firm context
   * exists; before the tenant middleware there is none, and those go to the
   * process log instead.
   */
  async consume(
    limitClass: LimitClass,
    caller: Caller,
    route: string,
  ): Promise<Decision> {
    const policy = POLICIES[limitClass];
    const now = this.now();
    let refusal: Decision | undefined;

    for (const rule of policy.rules) {
      const key = this.keyFor(limitClass, rule, caller);
      const result = await this.store.consume(
        key,
        rule.limit,
        WINDOW_MS[rule.window],
        now,
      );

      if (result.allowed || refusal) {
        continue;
      }

      refusal = {
        allowed: false,
        retryAfterSeconds: secondsUntil(result.resetAt, now),
        scope: rule.scope,
        window: rule.window,
        refusalNumber: result.count - rule.limit,
      };
    }

    if (refusal && !refusal.allowed) {
      await this.recordRefusal(limitClass, route, caller, refusal);
    }

    return refusal ?? { allowed: true };
  }

  /** The per-address flood ceiling, before anything else has run. */
  async consumeFlood(address: string): Promise<Decision> {
    const now = this.now();
    const result = await this.store.consume(
      `flood:${address}`,
      FLOOD_RULE.limit,
      WINDOW_MS[FLOOD_RULE.window],
      now,
    );

    if (result.allowed) {
      return { allowed: true };
    }

    const refusalNumber = result.count - FLOOD_RULE.limit;

    // No firm yet, so no audit entry; the log is what there is.
    if (shouldAuditRefusal(refusalNumber)) {
      this.logger.warn(
        `Flood limit: ${address} refused (${refusalNumber} this window)`,
      );
    }

    return {
      allowed: false,
      retryAfterSeconds: secondsUntil(result.resetAt, now),
      scope: "ip",
      window: FLOOD_RULE.window,
      refusalNumber,
    };
  }

  /**
   * Consumed only when a request to an authenticated route is about to be
   * answered 401. The session guard calls this on that path and nowhere else,
   * so a valid session is never counted and never refused by it.
   */
  async consumeUnauthenticated(
    address: string,
    firmId: string | undefined,
    route: string,
  ): Promise<Decision> {
    const now = this.now();
    const result = await this.store.consume(
      `unauthenticated:${address}`,
      UNAUTHENTICATED_RULE.limit,
      WINDOW_MS[UNAUTHENTICATED_RULE.window],
      now,
    );

    if (result.allowed) {
      return { allowed: true };
    }

    const refusal: Decision = {
      allowed: false,
      retryAfterSeconds: secondsUntil(result.resetAt, now),
      scope: "ip",
      window: UNAUTHENTICATED_RULE.window,
      refusalNumber: result.count - UNAUTHENTICATED_RULE.limit,
    };

    if (firmId && shouldAuditRefusal(refusal.refusalNumber)) {
      await this.audit.record({
        firmId,
        actorUserId: null,
        ip: address,
        action: "ratelimit.refused",
        detail: {
          class: "unauthenticated",
          scope: "ip",
          window: refusal.window,
          route,
          refusals: refusal.refusalNumber,
        },
      });
    }

    return refusal;
  }

  /**
   * Takes the in-flight slots a class requires — user, firm, process — or
   * none of them. Returns the release to call when the response ends.
   */
  async acquire(
    limitClass: LimitClass,
    caller: Caller,
    route: string,
  ): Promise<
    { acquired: true; release: () => Promise<void> } | { acquired: false; decision: Decision }
  > {
    const concurrency = POLICIES[limitClass].concurrency;

    if (!concurrency) {
      return { acquired: true, release: async () => {} };
    }

    const wanted: Array<{ key: string; max: number }> = [];

    if (concurrency.user !== undefined) {
      wanted.push({
        key: `inflight:${limitClass}:user:${this.identity("user", caller)}`,
        max: concurrency.user,
      });
    }
    if (concurrency.firm !== undefined) {
      wanted.push({
        key: `inflight:${limitClass}:firm:${this.identity("firm", caller)}`,
        max: concurrency.firm,
      });
    }
    if (concurrency.process !== undefined) {
      wanted.push({ key: `inflight:${limitClass}:process`, max: concurrency.process });
    }

    const held: string[] = [];

    for (const slot of wanted) {
      if (await this.store.acquire(slot.key, slot.max)) {
        held.push(slot.key);
        continue;
      }

      for (const key of held) {
        await this.store.release(key);
      }

      // Refusals of a slot are capped for the audit the same way: counted
      // per caller per minute, with the first and every hundredth recorded.
      const counter = await this.store.consume(
        `inflight-refusals:${limitClass}:${this.identity("user", caller)}`,
        0,
        WINDOW_MS.minute,
        this.now(),
      );

      const decision: Decision = {
        allowed: false,
        retryAfterSeconds: CONCURRENCY_RETRY_AFTER_SECONDS,
        scope: "concurrency",
        window: "concurrent",
        refusalNumber: counter.count,
      };

      await this.recordRefusal(limitClass, route, caller, decision);

      return { acquired: false, decision };
    }

    let released = false;

    return {
      acquired: true,
      release: async () => {
        if (released) return;
        released = true;
        for (const key of held) {
          await this.store.release(key);
        }
      },
    };
  }

  private keyFor(limitClass: LimitClass, rule: Rule, caller: Caller): string {
    return `${rule.scope}:${limitClass}:${rule.window}:${this.identity(rule.scope, caller)}`;
  }

  /**
   * What identifies the caller under each scope. A `user` rule on a request
   * with no session keys by address — a public route, or an authenticated one
   * reached without a session, which the session guard should have stopped
   * but which costs nothing to cover.
   */
  private identity(scope: Scope, caller: Caller): string {
    switch (scope) {
      case "ip":
        return caller.address;
      case "email":
        return `${caller.firmId ?? "-"}/${(caller.email ?? "").trim().toLowerCase()}`;
      case "user":
        return caller.userId
          ? `${caller.firmId ?? "-"}/${caller.userId}`
          : `ip/${caller.address}`;
      case "firm":
        return caller.firmId ?? `ip/${caller.address}`;
    }
  }

  private async recordRefusal(
    limitClass: LimitClass,
    route: string,
    caller: Caller,
    decision: Decision,
  ): Promise<void> {
    if (decision.allowed || !shouldAuditRefusal(decision.refusalNumber)) {
      return;
    }

    if (!caller.firmId) {
      this.logger.warn(
        `Rate limit: ${limitClass} refused for ${caller.address} on ${route} (${decision.refusalNumber} this window)`,
      );
      return;
    }

    await this.audit.record({
      firmId: caller.firmId,
      actorUserId: caller.userId ?? null,
      ip: caller.address,
      // The daily download ceiling gets its own action so that "who hit the
      // hourly limit" and "who hit the daily one" are different questions
      // with different answers, not one question with a detail to filter on.
      action:
        decision.window === "day" ? "ratelimit.refused_daily" : "ratelimit.refused",
      detail: {
        class: limitClass,
        scope: decision.scope,
        window: decision.window,
        route,
        refusals: decision.refusalNumber,
        // No email, even on the sign-in route: whether it belongs to anyone
        // is exactly what this table must not confirm.
      },
    });
  }
}

function secondsUntil(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

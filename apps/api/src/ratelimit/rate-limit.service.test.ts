import { describe, expect, it } from "vitest";
import {
  FLOOD_RULE,
  POLICIES,
  UNAUTHENTICATED_RULE,
  WINDOW_MS,
  type LimitClass,
} from "./policy.js";
import { MemoryRateLimitStore } from "./rate-limit-store.js";
import {
  RateLimitService,
  type Caller,
  type Decision,
  type RefusalRecord,
} from "./rate-limit.service.js";

/**
 * Every limit is proved by exceeding it. The clock is a variable, so a
 * day-long window is a number rather than a wait, and the audit is a list, so
 * the cap on refusal entries is counted rather than trusted.
 */
function harness(start = 1_000_000) {
  let now = start;
  const refusals: RefusalRecord[] = [];
  const service = new RateLimitService(
    new MemoryRateLimitStore(),
    { record: async (refusal) => void refusals.push(refusal) },
    () => now,
  );
  return {
    service,
    refusals,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const firmA = "aaaaaaaa-0000-4000-8000-000000000001";
const firmB = "bbbbbbbb-0000-4000-8000-000000000001";

function user(firmId: string, n: number): Caller {
  return { address: "10.0.0.1", firmId, userId: `user-${n}` };
}

/** Consumes `times` and returns the decisions, so N allowed then one refused is assertable. */
async function hit(
  service: RateLimitService,
  limitClass: LimitClass,
  caller: Caller | ((i: number) => Caller),
  times: number,
): Promise<Decision[]> {
  const decisions: Decision[] = [];
  for (let i = 0; i < times; i += 1) {
    const who = typeof caller === "function" ? caller(i) : caller;
    decisions.push(await service.consume(limitClass, who, `GET /test`));
  }
  return decisions;
}

function refusedAt(decisions: Decision[]): number {
  return decisions.findIndex((d) => !d.allowed);
}

describe("per-caller limits, every class", () => {
  // The first rule of each class with a caller-level scope, exceeded by one.
  const cases: Array<[LimitClass, number, Caller | ((i: number) => Caller)]> = [
    // A different email each time, so only the per-address rule is in play.
    ["auth", 100, (i) => ({ address: "203.0.113.5", firmId: firmA, email: `u${i}@y.z` })],
    ["invitation-lookup", 60, { address: "203.0.113.5", firmId: firmA }],
    ["invitation-accept", 40, { address: "203.0.113.5", firmId: firmA }],
    ["read", 120, user(firmA, 1)],
    ["write", 30, user(firmA, 1)],
    ["search", 60, user(firmA, 1)],
    ["invite", 30, user(firmA, 1)],
    ["upload", 300, user(firmA, 1)],
    ["download", 100, user(firmA, 1)],
  ];

  for (const [limitClass, limit, caller] of cases) {
    it(`${limitClass}: allows ${limit}, refuses the ${limit + 1}th`, async () => {
      const { service } = harness();
      const decisions = await hit(service, limitClass, caller, limit + 1);

      expect(refusedAt(decisions)).toBe(limit);

      const refusal = decisions[limit];
      expect(refusal?.allowed).toBe(false);
      if (refusal && !refusal.allowed) {
        const rule = POLICIES[limitClass].rules[0];
        expect(refusal.retryAfterSeconds).toBe(
          WINDOW_MS[rule?.window ?? "minute"] / 1000,
        );
      }
    });
  }

  it("auth: a tenth attempt on one email is refused from a fresh address", async () => {
    const { service } = harness();
    const first = await hit(
      service,
      "auth",
      { address: "198.51.100.1", firmId: firmA, email: "Target@Firm.sa" },
      10,
    );
    expect(first.every((d) => d.allowed)).toBe(true);

    // Different address, different spelling of the same email.
    const next = await service.consume(
      "auth",
      { address: "198.51.100.2", firmId: firmA, email: " target@firm.sa " },
      "POST /auth/login",
    );
    expect(next.allowed).toBe(false);
  });

  it("auth: the email counter is consumed even when the address refuses", async () => {
    const { service } = harness();
    const address = "198.51.100.9";

    await hit(service, "auth", { address, firmId: firmA, email: "a@b.c" }, 100);
    // Address exhausted; nine more attempts on a fresh email still count.
    await hit(service, "auth", { address, firmId: firmA, email: "fresh@b.c" }, 9);

    const fromElsewhere = await service.consume(
      "auth",
      { address: "198.51.100.10", firmId: firmA, email: "fresh@b.c" },
      "POST /auth/login",
    );
    // Tenth on that email: allowed. The eleventh is not.
    expect(fromElsewhere.allowed).toBe(true);
    const eleventh = await service.consume(
      "auth",
      { address: "198.51.100.10", firmId: firmA, email: "fresh@b.c" },
      "POST /auth/login",
    );
    expect(eleventh.allowed).toBe(false);
  });

  it("exempt: never refuses", async () => {
    const { service } = harness();
    const decisions = await hit(service, "exempt", user(firmA, 1), 5000);
    expect(decisions.every((d) => d.allowed)).toBe(true);
  });

  it("allows again once the window has passed", async () => {
    const { service, advance } = harness();
    await hit(service, "write", user(firmA, 1), 31);

    advance(WINDOW_MS.minute);

    const after = await service.consume("write", user(firmA, 1), "POST /x");
    expect(after.allowed).toBe(true);
  });
});

describe("one runaway user does not take the firm down", () => {
  it("2,000 reads a minute from one user never refuse a colleague", async () => {
    const { service } = harness();

    const runaway = await hit(service, "read", user(firmA, 1), 2000);
    expect(runaway.filter((d) => d.allowed)).toHaveLength(120);
    expect(runaway.filter((d) => !d.allowed)).toHaveLength(1880);
    // Every refusal was the user's own rule, never the firm's.
    expect(runaway.every((d) => d.allowed || d.scope === "user")).toBe(true);

    const colleague = await hit(service, "read", user(firmA, 2), 120);
    expect(colleague.every((d) => d.allowed)).toBe(true);
  });
});

describe("firm ceiling, two firms", () => {
  it("refuses firm A at its ceiling while firm B is untouched", async () => {
    const { service } = harness();
    const ceiling = 1500;
    const perUser = 120;

    // Thirteen users each under their own limit, together over the firm's.
    let refusedInA: Decision | undefined;
    let allowedInA = 0;

    for (let n = 1; n <= 13 && !refusedInA; n += 1) {
      for (let i = 0; i < perUser; i += 1) {
        const decision = await service.consume("read", user(firmA, n), "GET /cases");
        if (decision.allowed) {
          allowedInA += 1;
        } else {
          refusedInA = decision;
          break;
        }
      }
    }

    expect(allowedInA).toBe(ceiling);
    expect(refusedInA && !refusedInA.allowed && refusedInA.scope).toBe("firm");

    // A fourteenth user in firm A, who has made no requests at all, is
    // refused: the ceiling is the firm's, not theirs.
    const newcomer = await service.consume("read", user(firmA, 14), "GET /cases");
    expect(newcomer.allowed).toBe(false);

    // Firm B, same addresses, same minute: untouched.
    const decisions = await hit(service, "read", user(firmB, 1), perUser);
    expect(decisions.every((d) => d.allowed)).toBe(true);
  });
});

describe("download: hourly and daily", () => {
  it("refuses the 101st in an hour, then the 501st in a day, each audited distinctly", async () => {
    const { service, refusals, advance } = harness();
    const caller = user(firmA, 7);
    let allowedToday = 0;

    // Five hours at exactly the hourly limit: nothing refused, 500 allowed.
    for (let hour = 0; hour < 5; hour += 1) {
      const decisions = await hit(service, "download", caller, 100);
      allowedToday += decisions.filter((d) => d.allowed).length;
      advance(WINDOW_MS.hour);
    }

    expect(allowedToday).toBe(500);

    // Sixth hour: a fresh hourly window, but the day is spent. The very first
    // request is refused, and by the daily rule.
    const sixth = await service.consume("download", caller, "GET /d");
    expect(sixth.allowed).toBe(false);
    if (!sixth.allowed) expect(sixth.window).toBe("day");

    const hourly = refusals.filter((r) => r.action === "ratelimit.refused");
    const daily = refusals.filter((r) => r.action === "ratelimit.refused_daily");
    expect(hourly).toHaveLength(0);
    expect(daily).toHaveLength(1);
    expect(daily[0]?.detail["window"]).toBe("day");
    expect(daily[0]?.actorUserId).toBe("user-7");

    // Six hours in, the day has not reset.
    const still = await service.consume("download", caller, "GET /d");
    expect(still.allowed).toBe(false);

    advance(WINDOW_MS.day);
    const tomorrow = await service.consume("download", caller, "GET /d");
    expect(tomorrow.allowed).toBe(true);
  });

  /**
   * A refused download took nothing, so it spends nothing wider: the hourly
   * refusal does not touch the day. 101 an hour for five hours leaves the full
   * 500 allowed, and the day's budget is exactly the downloads that happened.
   */
  it("a request refused by the hour does not count against the day", async () => {
    const { service, advance } = harness();
    const caller = user(firmA, 8);
    let allowed = 0;

    for (let hour = 0; hour < 5; hour += 1) {
      const decisions = await hit(service, "download", caller, 101);
      allowed += decisions.filter((d) => d.allowed).length;
      expect(decisions[100]?.allowed).toBe(false);
      advance(WINDOW_MS.hour);
    }

    expect(allowed).toBe(500);

    // The day is spent by exactly those 500; the next is the daily rule.
    const next = await service.consume("download", caller, "GET /d");
    expect(!next.allowed && next.window).toBe("day");
  });
});

describe("concurrency slots", () => {
  it("upload: the third in flight for one user is refused, with Retry-After", async () => {
    const { service, refusals } = harness();
    const route = "POST /documents";

    const first = await service.acquire("upload", user(firmA, 1), route);
    const second = await service.acquire("upload", user(firmA, 1), route);
    const third = await service.acquire("upload", user(firmA, 1), route);
    expect(first.acquired && second.acquired).toBe(true);
    expect(third.acquired).toBe(false);

    if (!third.acquired && !third.decision.allowed) {
      expect(third.decision.scope).toBe("concurrency");
      expect(third.decision.retryAfterSeconds).toBeGreaterThan(0);
    }
    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.detail["window"]).toBe("concurrent");

    // Another user in the same firm is not affected by the first one's cap.
    expect((await service.acquire("upload", user(firmA, 2), route)).acquired).toBe(true);
  });

  it("firm ceiling on slots: the ninth in a firm is refused, and a release frees it", async () => {
    const { service } = harness();
    const route = "POST /documents";
    const acquired = [];

    for (let n = 1; n <= 4; n += 1) {
      acquired.push(await service.acquire("upload", user(firmA, n), route));
      acquired.push(await service.acquire("upload", user(firmA, n), route));
    }
    expect(acquired.every((a) => a.acquired)).toBe(true);

    const ninth = await service.acquire("upload", user(firmA, 5), route);
    expect(ninth.acquired).toBe(false);

    const first = acquired[0];
    if (first?.acquired) await first.release();

    const again = await service.acquire("upload", user(firmA, 5), route);
    expect(again.acquired).toBe(true);
  });

  it("process ceiling: the 21st upload on the instance is refused whoever asks", async () => {
    const { service } = harness();
    const route = "POST /documents";
    let held = 0;

    // Ten firms, two users each, one slot each: twenty, all under firm caps.
    for (let f = 0; f < 10; f += 1) {
      const firmId = `cccccccc-0000-4000-8000-0000000000${String(f).padStart(2, "0")}`;
      for (let n = 1; n <= 2; n += 1) {
        const slot = await service.acquire("upload", user(firmId, n), route);
        if (slot.acquired) held += 1;
      }
    }
    expect(held).toBe(20);

    const extra = await service.acquire("upload", user(firmB, 99), route);
    expect(extra.acquired).toBe(false);
  });

  it("download: 3 in flight per user", async () => {
    const { service } = harness();
    const route = "GET /documents/x/versions/1/download";
    for (let i = 0; i < 3; i += 1) {
      expect((await service.acquire("download", user(firmA, 1), route)).acquired).toBe(true);
    }
    expect((await service.acquire("download", user(firmA, 1), route)).acquired).toBe(false);
  });

  it("classes without concurrency never refuse a slot", async () => {
    const { service } = harness();
    for (let i = 0; i < 100; i += 1) {
      expect((await service.acquire("read", user(firmA, 1), "GET /x")).acquired).toBe(true);
    }
  });
});

describe("address-level rules", () => {
  it(`flood: refuses the ${FLOOD_RULE.limit + 1}th request from one address in a minute`, async () => {
    const { service } = harness();
    let refusedAt = -1;
    for (let i = 0; i < FLOOD_RULE.limit + 1; i += 1) {
      const decision = await service.consumeFlood("192.0.2.1");
      if (!decision.allowed) {
        refusedAt = i;
        break;
      }
    }
    expect(refusedAt).toBe(FLOOD_RULE.limit);
  });

  it(`unauthenticated: refuses the ${UNAUTHENTICATED_RULE.limit + 1}th 401 in a quarter hour, audited with no actor`, async () => {
    const { service, refusals } = harness();
    let refusedAt = -1;
    for (let i = 0; i < UNAUTHENTICATED_RULE.limit + 1; i += 1) {
      const decision = await service.consumeUnauthenticated("192.0.2.2", firmA, "GET /cases");
      if (!decision.allowed) {
        refusedAt = i;
        break;
      }
    }
    expect(refusedAt).toBe(UNAUTHENTICATED_RULE.limit);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.actorUserId).toBeNull();
    expect(refusals[0]?.detail["class"]).toBe("unauthenticated");
  });
});

describe("audit of refusals", () => {
  it("records the first refusal and every hundredth, nothing between", async () => {
    const { service, refusals } = harness();
    const caller = user(firmA, 3);

    // 30 allowed, then 250 refusals.
    await hit(service, "write", caller, 30 + 250);

    expect(refusals.map((r) => r.detail["refusals"])).toEqual([1, 100, 200]);
    expect(refusals[0]?.firmId).toBe(firmA);
    expect(refusals[0]?.actorUserId).toBe("user-3");
    expect(refusals[0]?.ip).toBe("10.0.0.1");
    expect(refusals[0]?.detail["class"]).toBe("write");
    expect(refusals[0]?.detail["scope"]).toBe("user");
  });

  it("never records the submitted email", async () => {
    const { service, refusals } = harness();
    const caller: Caller = { address: "203.0.113.7", firmId: firmA, email: "secret@firm.sa" };

    await hit(service, "auth", caller, 11);

    expect(refusals).toHaveLength(1);
    expect(JSON.stringify(refusals[0])).not.toContain("secret@firm.sa");
  });

  it("records nothing and does not fail when there is no firm context", async () => {
    const { service, refusals } = harness();
    const caller: Caller = { address: "203.0.113.8" };

    const decisions = await hit(service, "read", caller, 121);

    expect(decisions[120]?.allowed).toBe(false);
    expect(refusals).toHaveLength(0);
  });
});

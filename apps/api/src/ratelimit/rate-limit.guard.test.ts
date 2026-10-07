import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { setFirmId } from "../tenant/tenant-request.js";
import { setClientAddress } from "./client-address.js";
import { MemoryRateLimitStore } from "./rate-limit-store.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { RateLimitService } from "./rate-limit.service.js";

const firmA = "aaaaaaaa-0000-4000-8000-000000000001";

/**
 * The guard reads `body.email` on the sign-in route before any validation has
 * run, so the body is whatever the client sent. These cases are the ones a
 * client would send to crash the guard or to slip past the per-email rule:
 * none of them may do either.
 */
function guardWith(limitClass = "auth") {
  const service = new RateLimitService(
    new MemoryRateLimitStore(),
    { record: async () => undefined },
    () => 1_000_000,
  );
  const reflector = { getAllAndOverride: () => limitClass } as unknown as Reflector;
  return new RateLimitGuard(reflector, service);
}

function contextFor(body: unknown, address = "203.0.113.1"): ExecutionContext {
  const request = {
    method: "POST",
    url: "/api/auth/login",
    body,
    headers: {},
    socket: { remoteAddress: address },
  } as never;
  setFirmId(request, firmA);
  setClientAddress(request, address);

  const headers: Record<string, string> = {};
  const response = {
    setHeader: (name: string, value: string) => void (headers[name] = value),
    once: () => undefined,
    headers,
  };

  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

async function attempts(guard: RateLimitGuard, body: () => unknown, times: number) {
  let allowed = 0;
  let refused = 0;
  let retryAfter: string | undefined;

  for (let i = 0; i < times; i += 1) {
    const context = contextFor(body());
    try {
      await guard.canActivate(context);
      allowed += 1;
    } catch (error) {
      refused += 1;
      expect((error as { getStatus?: () => number }).getStatus?.()).toBe(429);
      retryAfter = (context.switchToHttp().getResponse() as { headers: Record<string, string> })
        .headers["Retry-After"];
    }
  }

  return { allowed, refused, retryAfter };
}

describe("RateLimitGuard reading the sign-in body", () => {
  const hostile: Array<[string, () => unknown]> = [
    ["no body at all", () => undefined],
    ["a body with no email", () => ({ password: "x" })],
    ["a number", () => ({ email: 12345 })],
    ["null", () => ({ email: null })],
    ["an object", () => ({ email: { $ne: "" } })],
    ["an array", () => ({ email: ["a@b.c", "d@e.f"] })],
    ["a non-object body", () => "just a string"],
    ["an array body", () => ["a@b.c"]],
  ];

  for (const [label, body] of hostile) {
    it(`${label}: does not crash, and the eleventh attempt is refused`, async () => {
      const guard = guardWith();
      const result = await attempts(guard, body, 11);
      expect(result).toMatchObject({ allowed: 10, refused: 1 });
      expect(result.retryAfter).toBe("900");
    });
  }

  it("the hostile shapes all share one bucket, so switching between them buys nothing", async () => {
    const guard = guardWith();
    let allowed = 0;
    for (let i = 0; i < 11; i += 1) {
      const body = hostile[i % hostile.length]?.[1] ?? (() => undefined);
      try {
        await guard.canActivate(contextFor(body()));
        allowed += 1;
      } catch {
        // refused
      }
    }
    expect(allowed).toBe(10);
  });

  it("an oversized email is counted like any other and cannot grow the key", async () => {
    const guard = guardWith();
    const huge = `${"a".repeat(100_000)}@example.test`;
    const result = await attempts(guard, () => ({ email: huge, password: "x" }), 11);
    expect(result).toMatchObject({ allowed: 10, refused: 1 });

    // A different oversized email is a different account, still limited.
    const other = `${"b".repeat(100_000)}@example.test`;
    const second = await attempts(guard, () => ({ email: other, password: "x" }), 11);
    expect(second).toMatchObject({ allowed: 10, refused: 1 });
  });

  it("case and surrounding whitespace do not split one email across buckets", async () => {
    const guard = guardWith();
    const spellings = ["User@Firm.sa", " user@firm.sa", "USER@FIRM.SA ", "user@firm.sa"];
    let i = 0;
    const result = await attempts(guard, () => ({ email: spellings[i++ % 4] }), 11);
    expect(result).toMatchObject({ allowed: 10, refused: 1 });
  });

  it("the per-address rule still applies when every email is different", async () => {
    const guard = guardWith();
    let i = 0;
    const result = await attempts(guard, () => ({ email: `u${i++}@firm.sa` }), 101);
    expect(result).toMatchObject({ allowed: 100, refused: 1 });
  });
});

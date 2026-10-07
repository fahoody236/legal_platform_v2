import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ServerResponse } from "node:http";
import {
  getSession,
  type AuthenticatedRequest,
} from "../auth/authenticated-request.js";
import { getFirmId } from "../tenant/tenant-request.js";
import { clientAddressOf } from "./client-address.js";
import { DEFAULT_CLASS, type LimitClass } from "./policy.js";
import { RATE_LIMIT_CLASS } from "./rate-limit.decorator.js";
import { RateLimitService, type Caller, type Decision } from "./rate-limit.service.js";

/**
 * The per-user and per-firm limits, as a global guard.
 *
 * ── Where it runs ────────────────────────────────────────────────────────────
 *
 * After the session guard and before the permission guard. It has to follow
 * the session guard because its keys are the user and the firm, which only
 * exist once the session is read. It precedes the permission guard so that a
 * caller hammering a route they are not allowed is counted before they are
 * refused — the 403 still costs the permissions query, and that is what the
 * count protects.
 *
 * The order is the module import order in AppModule, as ADR 0004 records for
 * the other two guards. RateLimitModule sits between AuthModule and
 * PermissionsModule there, and nothing asserts it.
 *
 * ── A refusal ────────────────────────────────────────────────────────────────
 *
 * 429, empty body, `Retry-After` in seconds. The body is empty for the same
 * reason sign-in's 401 is: on the public routes, the counters were consumed
 * before any lookup, so the refusal says nothing about whether the email or
 * the token exists.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limitClass =
      this.reflector.getAllAndOverride<LimitClass | undefined>(
        RATE_LIMIT_CLASS,
        [context.getHandler(), context.getClass()],
      ) ?? DEFAULT_CLASS;

    if (limitClass === "exempt") {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<ServerResponse>();
    const route = `${request.method ?? ""} ${request.url?.split("?")[0] ?? ""}`;

    const caller: Caller = {
      address: clientAddressOf(request),
      firmId: getFirmId(request),
      userId: getSession(request)?.user.userId,
      // The body has been parsed by Express by now but not yet validated.
      // Read as submitted; a non-string is counted under an empty key and
      // then rejected by the schema like any other malformed body.
      email: emailOf(request),
    };

    const decision = await this.limiter.consume(limitClass, caller, route);

    if (!decision.allowed) {
      throw refused(response, decision);
    }

    const slots = await this.limiter.acquire(limitClass, caller, route);

    if (!slots.acquired) {
      throw refused(response, slots.decision);
    }

    // `close` fires whether the response finished or the socket dropped, so
    // a slot cannot be held by a download the client walked away from.
    response.once("close", () => {
      void slots.release();
    });

    return true;
  }
}

function emailOf(request: AuthenticatedRequest): string | undefined {
  const body: unknown = (request as { body?: unknown }).body;

  if (typeof body !== "object" || body === null || !("email" in body)) {
    return undefined;
  }

  const email = (body as { email: unknown }).email;
  return typeof email === "string" ? email : "";
}

/**
 * 429 with `Retry-After`. The body is `{}` unless the caller gives one — an
 * empty object rather than an empty string, because Nest renders a string
 * message as `{ statusCode, message }`, and the point is to say nothing. The
 * only body given is the session guard's `{ code: "unauthenticated" }`, which
 * tells the client what the 401 it replaced would have told it, so the
 * interface can go to sign-in rather than to an error page.
 */
export function refused(
  response: ServerResponse,
  decision: Decision,
  body: Record<string, unknown> = {},
): HttpException {
  if (!decision.allowed) {
    response.setHeader("Retry-After", String(decision.retryAfterSeconds));
  }
  return new HttpException(body, HttpStatus.TOO_MANY_REQUESTS);
}

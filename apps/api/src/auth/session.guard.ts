import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ServerResponse } from "node:http";
import { clientAddressOf } from "../ratelimit/client-address.js";
import { refused } from "../ratelimit/rate-limit.guard.js";
import { RateLimitService } from "../ratelimit/rate-limit.service.js";
import { getFirmId, type TenantRequest } from "../tenant/tenant-request.js";
import { AuthService } from "./auth.service.js";
import {
  setSession,
  type AuthenticatedRequest,
} from "./authenticated-request.js";
import { readSessionCookie } from "./cookies.js";
import { IS_PUBLIC } from "./public.decorator.js";

/**
 * Registered globally, so the default for every route — including every route
 * not written yet — is that it requires a session. A new endpoint is protected
 * the moment it exists; opting out takes an explicit `@Public()` on the handler.
 *
 * The alternative, listing protected paths somewhere central, fails in the one
 * direction that matters: the mistake is silent, and its symptom is an open
 * endpoint that behaves perfectly.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // The firm comes from the tenant middleware, which has already run. Without
    // it there is nothing to scope the session lookup to, and a session cannot
    // be validated outside a tenant context at all.
    const firmId = getFirmId(request as TenantRequest);
    const token = readSessionCookie(request.headers.cookie);

    if (!firmId || !token) {
      throw await this.unauthorised(context, firmId);
    }

    const session = await this.authService.validateSession(firmId, token);

    if (!session) {
      throw await this.unauthorised(context, firmId);
    }

    setSession(request, session);
    return true;
  }

  /**
   * The 401 path, and the one place the unauthenticated rule is consumed.
   *
   * Counting here rather than on arrival is what makes the rule safe for an
   * office behind one address: a request that carries a valid session is
   * never counted, so a firm whose tabs all expired at once can trip the rule
   * and still have every signed-in person working. What the address loses is
   * only the ability to be refused faster — 429 in place of 401 — on requests
   * that would have been refused anyway. Sign-in, the invitation routes and
   * /health are `@Public()` and never reach this method.
   */
  private async unauthorised(
    context: ExecutionContext,
    firmId: string | undefined,
  ): Promise<Error> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const route = `${request.method ?? ""} ${request.url?.split("?")[0] ?? ""}`;

    const decision = await this.limiter.consumeUnauthenticated(
      clientAddressOf(request),
      firmId,
      route,
    );

    if (!decision.allowed) {
      return refused(http.getResponse<ServerResponse>(), decision);
    }

    return new UnauthorizedException();
  }
}

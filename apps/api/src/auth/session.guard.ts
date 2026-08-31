import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
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
      throw new UnauthorizedException();
    }

    const session = await this.authService.validateSession(firmId, token);

    if (!session) {
      throw new UnauthorizedException();
    }

    setSession(request, session);
    return true;
  }
}

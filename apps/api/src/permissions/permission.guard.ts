import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC } from "../auth/public.decorator.js";
import {
  getSession,
  type AuthenticatedRequest,
} from "../auth/authenticated-request.js";
import { getFirmId } from "../tenant/tenant-request.js";
import { PermissionsService } from "./permissions.service.js";
import { REQUIRED_PERMISSION } from "./require-permission.decorator.js";
import { IS_SESSION_ONLY } from "./session-only.decorator.js";

/**
 * The second half of deny-by-default, and the half that is mechanical.
 *
 * Registered globally and *after* SessionGuard, so by the time this runs the
 * caller is either known or has already been rejected. It then asks one
 * question: what did this route declare? Not "was a permission declared that
 * the caller lacks" — the absence of a declaration is itself the denial.
 *
 * That is the direction that matters. A guard which only enforces declarations
 * it finds leaves an undeclared route wide open, and an open route looks exactly
 * like a working one; nothing fails, no log line appears, and the mistake
 * surfaces when someone reads data they should not have. Here the same omission
 * produces a 403 on the developer's first request, before review, let alone
 * production.
 *
 * The boot-time check that would make the same omission *loud* — refusing to
 * start rather than waiting to be asked — is deferred; see the TODO in
 * permissions.module.ts. Until it exists this guard is the whole of the
 * property, which is the right half to have if only one: it makes the mistake
 * harmless, where the check would only make it early.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<string>(
      REQUIRED_PERMISSION,
      targets,
    );

    if (!required) {
      // Session-only routes are about the session itself — see the decorator.
      // Anything else that reaches here declared nothing, and gets the denial
      // that an undeclared route is supposed to get.
      if (this.reflector.getAllAndOverride<boolean>(IS_SESSION_ONLY, targets)) {
        return true;
      }

      throw new ForbiddenException();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const firmId = getFirmId(request);
    const session = getSession(request);

    // SessionGuard has run and let a non-public route through, so both of these
    // are present in every ordering the application actually has. Checking
    // anyway costs one comparison and means a future reordering degrades to
    // "everyone is signed out" rather than to "nobody is checked".
    if (!firmId || !session) {
      throw new UnauthorizedException();
    }

    const held = await this.permissions.effectivePermissions(
      firmId,
      session.user.userId,
    );

    if (!held.has(required)) {
      // 403, and deliberately without naming the permission. Telling a caller
      // which key would have worked describes the firm's role structure to
      // someone who has just been told they are not part of it.
      throw new ForbiddenException();
    }

    return true;
  }
}

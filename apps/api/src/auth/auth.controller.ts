import type { ServerResponse } from "node:http";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { SessionOnly } from "../permissions/session-only.decorator.js";
import { requireFirmId } from "../tenant/tenant-request.js";
import {
  AuthService,
  type AuthenticatedUser,
} from "./auth.service.js";
import {
  requireSession,
  type AuthenticatedRequest,
} from "./authenticated-request.js";
import { clearSessionCookie, setSessionCookie } from "./cookies.js";
import { loginSchema, type LoginInput } from "./dto.js";
import { Public } from "./public.decorator.js";
import { clientAddressOf } from "../ratelimit/client-address.js";
import { RateLimit } from "../ratelimit/rate-limit.decorator.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * The firm is taken from the tenant middleware — from the Host header — and
   * never from the body. There is no field a caller could set to choose which
   * firm to authenticate against.
   *
   * Every failure is 401 with an empty body: unknown address, wrong password,
   * locked credential, disabled user. The service already collapses those into
   * one value; this keeps the HTTP surface from reintroducing a distinction.
   */
  @Public()
  @RateLimit("auth")
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() body: LoginInput,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<{ user: AuthenticatedUser }> {
    const firmId = requireFirmId(request);

    // The `auth` limits — per address and per submitted email — were consumed
    // by RateLimitGuard before this ran, so throttled traffic never reaches
    // Argon2, which is expensive by design and therefore worth shielding from
    // anyone who has stopped caring about the answers. Refusals are 429, not
    // a 401 that would hide the throttling: a refused request returns at
    // once while a real attempt spends ~22ms in Argon2, so the clock would
    // announce the difference anyway, and being honest stops a locked-out
    // colleague from concluding they have forgotten a password.
    const ip = clientAddressOf(request);

    const result = await this.authService.login(
      firmId,
      body.email,
      body.password,
      ip,
    );

    if (result.outcome !== "authenticated") {
      throw new UnauthorizedException();
    }

    setSessionCookie(response, request, result.token, result.expiresAt);

    // The token is not in this body, on purpose. See cookies.ts.
    return { user: result.user };
  }

  /**
   * Ends the caller's own session, so the session is both the credential and
   * the resource. There is no permission to require: a firm cannot coherently
   * grant or withhold the ability to sign out, and a user who has lost every
   * permission still needs to be able to leave.
   */
  @SessionOnly()
  @RateLimit("write")
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<void> {
    const firmId = requireFirmId(request);
    const { sessionId, user } = requireSession(request);

    await this.authService.logout(
      firmId,
      sessionId,
      user.userId,
      clientAddressOf(request),
    );
    clearSessionCookie(response, request);
  }

  /**
   * Who the caller is, and what they may do.
   *
   * Still `@SessionOnly()`, and adding the permission list does not change that.
   * An earlier version of this comment said the caller's permissions would be
   * "a different route with a different rule"; on reflection they are not.
   * Effective permissions are derived from the session exactly as the name is,
   * describe only the caller, and reveal nothing about anyone else — not which
   * roles the firm has defined, not who else holds what. A permission gating
   * someone's view of their own access would be as incoherent as one gating
   * their own name.
   *
   * The list exists so the interface can avoid offering actions that will be
   * refused. It is not a control: PermissionGuard decides, on every request,
   * from the database. A caller who edits this response has changed what their
   * own browser draws and nothing else.
   *
   * Costs one indexed query per call. This route is hit on each navigation, so
   * that is the price of the button being right; see AuthService.permissionsFor
   * for why it is not folded into session validation instead.
   */
  @SessionOnly()
  @Get("me")
  async me(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ user: AuthenticatedUser; permissions: string[] }> {
    const firmId = requireFirmId(request);
    const { user } = requireSession(request);

    return {
      user,
      permissions: await this.authService.permissionsFor(firmId, user.userId),
    };
  }
}

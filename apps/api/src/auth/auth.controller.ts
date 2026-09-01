import type { ServerResponse } from "node:http";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
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
import { LoginRateLimiter } from "./login-rate-limiter.js";
import { Public } from "./public.decorator.js";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly rateLimiter: LoginRateLimiter,
  ) {}

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
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() body: LoginInput,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<{ user: AuthenticatedUser }> {
    const firmId = requireFirmId(request);

    // Consumed before the password is verified, so throttled traffic never
    // reaches Argon2 — which is expensive by design and therefore worth
    // shielding from anyone who has stopped caring about the answers.
    const ip = request.socket.remoteAddress ?? null;

    // Not audited, and that is a gap rather than a decision: a throttled request
    // never reaches the service, so it never reaches a tenant transaction to
    // record itself in. Sustained throttling is exactly what a firm reviewing an
    // attack would want to see. Recording it needs a transaction opened for the
    // entry alone, which is a different shape from every other entry here.
    if (!this.rateLimiter.allow(ip ?? "unknown", body.email)) {
      // 429 rather than a 401 that would hide the throttling. It would not hide
      // it anyway: a rejected request returns immediately, while a real attempt
      // spends ~22ms in Argon2, so the clock announces the difference whatever
      // the status code says. Given that, being honest costs nothing and stops
      // a locked-out colleague from concluding they have forgotten a password.
      throw new HttpException("", HttpStatus.TOO_MANY_REQUESTS);
    }

    const result = await this.authService.login(
      firmId,
      body.email,
      body.password,
      ip,
    );

    if (result.outcome !== "authenticated") {
      throw new UnauthorizedException();
    }

    setSessionCookie(response, result.token, result.expiresAt);

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
      request.socket.remoteAddress ?? null,
    );
    clearSessionCookie(response);
  }

  /**
   * Returns nothing the caller did not already present. Everything in the body
   * came from the session this request authenticated with, so gating it behind
   * `users.view` would mean a firm could remove someone's ability to see their
   * own name — locking them out of the interface without denying them a single
   * record. If this ever grows to return the caller's permissions or firm
   * settings, that is a different route with a different rule.
   */
  @SessionOnly()
  @Get("me")
  me(@Req() request: AuthenticatedRequest): { user: AuthenticatedUser } {
    return { user: requireSession(request).user };
  }
}

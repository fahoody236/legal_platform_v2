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
    const ip = request.socket.remoteAddress ?? "unknown";

    if (!this.rateLimiter.allow(ip, body.email)) {
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
    );

    if (result.outcome !== "authenticated") {
      throw new UnauthorizedException();
    }

    setSessionCookie(response, result.token, result.expiresAt);

    // The token is not in this body, on purpose. See cookies.ts.
    return { user: result.user };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<void> {
    const firmId = requireFirmId(request);
    const { sessionId } = requireSession(request);

    await this.authService.logout(firmId, sessionId);
    clearSessionCookie(response);
  }

  @Get("me")
  me(@Req() request: AuthenticatedRequest): { user: AuthenticatedUser } {
    return { user: requireSession(request).user };
  }
}

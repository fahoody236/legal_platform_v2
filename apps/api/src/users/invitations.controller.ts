import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { Public } from "../auth/public.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { requireFirmId } from "../tenant/tenant-request.js";
import {
  acceptInvitationSchema,
  lookupInvitationSchema,
  type AcceptInvitationInput,
  type LookupInvitationInput,
} from "./dto.js";
import { UsersService, type InvitationPreview } from "./users.service.js";

/**
 * The two routes a person uses before they have a session: reading who an
 * invitation is for, and accepting it. Both are `@Public()` — the third and
 * fourth such routes in the application, and each is a deliberate statement
 * that the route exposes nothing beyond what the token already proves.
 *
 * The token travels in the body, not the path. The interface's own URL
 * carries it (that is the link), but an API path would put it into access
 * logs on every hop, and a value that sets a password should not live there.
 *
 * The firm is resolved from the Host like every request, so a token is only
 * meaningful on the subdomain that issued it. There is no rate limit here:
 * the token is 256 random bits, so guessing is not a threat, and the
 * expensive step — hashing the password — happens only after the token has
 * been found.
 */
@Controller("invitations")
export class InvitationsController {
  constructor(private readonly users: UsersService) {}

  /** 404 for a dead link of any kind: used, revoked, expired, or never issued. */
  @Public()
  @Post("lookup")
  @HttpCode(HttpStatus.OK)
  async lookup(
    @Body(new ZodValidationPipe(lookupInvitationSchema))
    body: LookupInvitationInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ invitation: InvitationPreview }> {
    const invitation = await this.users.lookupInvitation(
      requireFirmId(request),
      body.token,
    );

    if (!invitation) {
      throw new NotFoundException();
    }

    return { invitation };
  }

  /**
   * 204 and the person can sign in. Does not open a session: they have just
   * chosen a password, and typing it once more on the sign-in form is the
   * cheapest confirmation that they know it.
   */
  @Public()
  @Post("accept")
  @HttpCode(HttpStatus.NO_CONTENT)
  async accept(
    @Body(new ZodValidationPipe(acceptInvitationSchema))
    body: AcceptInvitationInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const accepted = await this.users.acceptInvitation(
      requireFirmId(request),
      body.token,
      body.password,
      request.socket.remoteAddress ?? null,
    );

    if (!accepted) {
      throw new NotFoundException();
    }
  }
}

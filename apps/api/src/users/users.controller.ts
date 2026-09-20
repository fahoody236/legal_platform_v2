import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { requestOrigin } from "../auth/cookies.js";
import { actorOf, translateWriteError } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { RequirePermission } from "../permissions/require-permission.decorator.js";
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  userIdSchema,
  type CreateUserInput,
  type ListUsersQuery,
  type UpdateUserInput,
} from "./dto.js";
import {
  UsersService,
  type DirectoryUser,
  type InvitationSummary,
  type IssuedInvitation,
} from "./users.service.js";

/**
 * The firm's own user directory, and — under `users.manage` — the people in it.
 *
 * Reads are gated by `users.view`, not by `cases.assign`. Those are different
 * questions: one is "may this person read who works here", the other is "may
 * they decide who carries a matter". A firm can reasonably grant either without
 * the other, and letting `cases.assign` imply the directory would widen what
 * that permission discloses without anyone choosing it.
 *
 * The consequence is real and is handled in the interface rather than papered
 * over here: someone holding `cases.assign` alone cannot list colleagues, so
 * the assignment control offers them the one action that needs no list —
 * removing the current assignment — and says why the rest is unavailable.
 *
 * Writes are `users.manage`. Roles are the one exception: `PATCH /users/:id/
 * roles` lives in RolesController under `roles.manage`, because changing what
 * someone may do is a permissions decision whatever record it is stored on.
 * That is also why `POST /users` takes no roles — see createUserSchema.
 *
 * No pagination. A firm's staff is bounded in a way its client list is not, and
 * a page size on this would be a control nobody would ever page through. If a
 * firm ever grows past the point where that is true, this needs the same
 * treatment the clients list has.
 */
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermission("users.view")
  @Get()
  async list(
    @Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ users: DirectoryUser[] }> {
    return {
      users: await this.users.list(actorOf(request), {
        includeDisabled: query.includeDisabled,
      }),
    };
  }

  /**
   * The latest invitation per user, for the users screen to say who has not
   * chosen a password yet. Under `users.manage` rather than `users.view`: the
   * directory is for naming colleagues, and whether someone has finished
   * signing up is an administrator's concern.
   */
  @RequirePermission("users.manage")
  @Get("invitations")
  async invitations(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ invitations: InvitationSummary[] }> {
    return { invitations: await this.users.listInvitations(actorOf(request)) };
  }

  /**
   * 409 for an address already used in this firm, case-insensitively — the
   * unique index decides, not a lookup that could race it.
   */
  @RequirePermission("users.manage")
  @Post()
  async create(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ user: DirectoryUser; invitation: IssuedInvitation }> {
    try {
      return await this.users.create(
        actorOf(request),
        requestOrigin(request),
        body,
      );
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  @RequirePermission("users.manage")
  @Patch(":id")
  async update(
    @Param("id", new ZodValidationPipe(userIdSchema)) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ user: DirectoryUser }> {
    const user = await this.users.update(actorOf(request), id, body);

    if (!user) {
      throw new NotFoundException();
    }

    return { user };
  }

  /**
   * The last-administrator rule is not checked here. It is the deferred
   * trigger from migration 0015, so it holds for a script as well as for this
   * route; this layer recognises its SQLSTATE and answers 409 with the code
   * the interface already knows from the role screens.
   */
  @RequirePermission("users.manage")
  @Post(":id/disable")
  @HttpCode(HttpStatus.OK)
  async disable(
    @Param("id", new ZodValidationPipe(userIdSchema)) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ user: DirectoryUser }> {
    let user: DirectoryUser | undefined;

    try {
      user = await this.users.disable(actorOf(request), id);
    } catch (error) {
      throw translateWriteError(error);
    }

    if (!user) {
      throw new NotFoundException();
    }

    return { user };
  }

  @RequirePermission("users.manage")
  @Post(":id/enable")
  @HttpCode(HttpStatus.OK)
  async enable(
    @Param("id", new ZodValidationPipe(userIdSchema)) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ user: DirectoryUser }> {
    const user = await this.users.enable(actorOf(request), id);

    if (!user) {
      throw new NotFoundException();
    }

    return { user };
  }

  /**
   * A new link for someone who never got theirs, or whose link expired.
   * 409 `user_disabled` for a disabled colleague: enable them first, which is
   * a separate, audited decision rather than a side effect of resending.
   */
  @RequirePermission("users.manage")
  @Post(":id/invitations")
  async resendInvitation(
    @Param("id", new ZodValidationPipe(userIdSchema)) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ invitation: IssuedInvitation }> {
    const result = await this.users.resendInvitation(
      actorOf(request),
      requestOrigin(request),
      id,
    );

    if (result.outcome === "not_found") {
      throw new NotFoundException();
    }

    if (result.outcome === "disabled") {
      throw new ConflictException({ code: "user_disabled" });
    }

    return { invitation: result.invitation };
  }
}

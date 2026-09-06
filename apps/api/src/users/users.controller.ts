import { Controller, Get, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { actorOf } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { RequirePermission } from "../permissions/require-permission.decorator.js";
import { listUsersQuerySchema, type ListUsersQuery } from "./dto.js";
import { UsersService, type DirectoryUser } from "./users.service.js";

/**
 * The firm's own user directory.
 *
 * Gated by `users.view`, not by `cases.assign`. Those are different questions:
 * one is "may this person read who works here", the other is "may they decide
 * who carries a matter". A firm can reasonably grant either without the other,
 * and letting `cases.assign` imply the directory would widen what that
 * permission discloses without anyone choosing it.
 *
 * The consequence is real and is handled in the interface rather than papered
 * over here: someone holding `cases.assign` alone cannot list colleagues, so
 * the assignment control offers them the one action that needs no list —
 * removing the current assignment — and says why the rest is unavailable.
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
}

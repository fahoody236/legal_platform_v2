import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import type {
  PermissionGroup,
  Role,
  RoleAssignment,
  RoleWithDetails,
} from "@legal/db";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { actorOf, translateWriteError } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { RequirePermission } from "../permissions/require-permission.decorator.js";
import {
  createRoleSchema,
  roleIdSchema,
  setUserRolesSchema,
  updateRoleSchema,
  userIdSchema,
  type CreateRoleInput,
  type SetUserRolesInput,
  type UpdateRoleInput,
} from "./dto.js";
import { RolesService } from "./roles.service.js";

/**
 * `roles.view` reads, `roles.manage` writes — including assigning roles to
 * people, which is under `roles.manage` rather than `users.manage` because
 * changing what someone may do is a permissions decision, whatever record it
 * is stored against.
 *
 * The last-administrator rule is not checked here. It is a deferred trigger
 * (migration 0015), so it holds for a script as well as this route; what this
 * layer does is recognise its SQLSTATE and answer 409 with a code the interface
 * can turn into the right Arabic. See translateWriteError.
 */
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequirePermission("roles.view")
  @Get("roles")
  async list(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ roles: RoleWithDetails[] }> {
    return { roles: await this.roles.list(actorOf(request)) };
  }

  /**
   * The catalogue, grouped by resource in display order. Global reference
   * data, but gated by `roles.view` like the rest: a permission list is a map
   * of what the product can do, which is not nothing to someone probing it.
   */
  @RequirePermission("roles.view")
  @Get("permissions")
  async permissions(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ groups: PermissionGroup[] }> {
    return { groups: await this.roles.permissionGroups(actorOf(request)) };
  }

  /** Who holds what, as pairs, for the users screen to join client-side. */
  @RequirePermission("roles.view")
  @Get("roles/assignments")
  async assignments(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ assignments: RoleAssignment[] }> {
    return { assignments: await this.roles.assignments(actorOf(request)) };
  }

  @RequirePermission("roles.manage")
  @Post("roles")
  async create(
    @Body(new ZodValidationPipe(createRoleSchema)) body: CreateRoleInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ role: Role }> {
    try {
      return { role: await this.roles.create(actorOf(request), body) };
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  @RequirePermission("roles.manage")
  @Patch("roles/:id")
  async update(
    @Param("id", new ZodValidationPipe(roleIdSchema)) id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: UpdateRoleInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ role: Role }> {
    let updated: Role | undefined;

    try {
      updated = await this.roles.update(actorOf(request), id, body);
    } catch (error) {
      throw translateWriteError(error);
    }

    if (!updated) {
      throw new NotFoundException();
    }

    return { role: updated };
  }

  @RequirePermission("roles.manage")
  @Post("roles/:id/archive")
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param("id", new ZodValidationPipe(roleIdSchema)) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ role: Role }> {
    let archived: Role | undefined;

    try {
      archived = await this.roles.archive(actorOf(request), id);
    } catch (error) {
      throw translateWriteError(error);
    }

    if (!archived) {
      throw new NotFoundException();
    }

    return { role: archived };
  }

  @RequirePermission("roles.manage")
  @Patch("users/:id/roles")
  async setUserRoles(
    @Param("id", new ZodValidationPipe(userIdSchema)) id: string,
    @Body(new ZodValidationPipe(setUserRolesSchema)) body: SetUserRolesInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ removed: string[]; added: string[] }> {
    let change: { removed: string[]; added: string[] } | undefined;

    try {
      change = await this.roles.setUserRoles(actorOf(request), id, body.roleIds);
    } catch (error) {
      throw translateWriteError(error);
    }

    if (!change) {
      throw new NotFoundException();
    }

    return change;
  }
}

import { Inject, Injectable } from "@nestjs/common";
import {
  archiveRole,
  createRole,
  findRoleById,
  findUserById,
  grantPermissionsToRole,
  listPermissionGroups,
  listRoleAssignments,
  listRoles,
  setRolePermissions,
  setUserRoles,
  updateRole,
  withTenant,
  type Database,
  type PermissionGroup,
  type Role,
  type RoleAssignment,
  type RoleWithDetails,
} from "@legal/db";
import { AuditService } from "../audit/audit.service.js";
import type { Actor } from "../common/request-context.js";
import { DATABASE } from "../database/database.module.js";
import type { CreateRoleInput, UpdateRoleInput } from "./dto.js";

@Injectable()
export class RolesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor): Promise<RoleWithDetails[]> {
    return withTenant(this.db, actor.firmId, (tx) => listRoles(tx));
  }

  async permissionGroups(actor: Actor): Promise<PermissionGroup[]> {
    return withTenant(this.db, actor.firmId, (tx) => listPermissionGroups(tx));
  }

  async assignments(actor: Actor): Promise<RoleAssignment[]> {
    return withTenant(this.db, actor.firmId, (tx) => listRoleAssignments(tx));
  }

  /**
   * The role and its initial permissions in one transaction, one audit entry.
   * The entry records the keys granted — a role's permission set is the fact a
   * later question about "who could do X at the time" is answered from.
   */
  async create(actor: Actor, input: CreateRoleInput): Promise<Role> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const created = await createRole(tx, {
        name: input.name,
        description: input.description ?? null,
      });

      await grantPermissionsToRole(tx, created.id, input.permissionKeys);

      await this.audit.record(tx, {
        action: "roles.created",
        resourceType: "role",
        resourceId: created.id,
        actorUserId: actor.userId,
        detail: { name: created.name, permissionKeys: [...input.permissionKeys].sort() },
        ip: actor.ip,
      });

      return created;
    });
  }

  /**
   * Name, description and permission set, in one transaction.
   *
   * The permission replacement is delete-all-then-insert, so between the two
   * statements the role briefly has no permissions. That is invisible to
   * everyone else — the transaction is not committed — and it is the reason
   * the last-administrator check runs at commit rather than per statement:
   * checked in the middle, every edit to the administrators' role would fail.
   *
   * If the end state leaves the firm without an administrator, the commit is
   * refused with SQLSTATE LA001 and nothing here — including the audit entry —
   * is written. An edit that did not happen is not recorded.
   */
  async update(
    actor: Actor,
    id: string,
    input: UpdateRoleInput,
  ): Promise<Role | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const before = await findRoleById(tx, id);

      if (!before) {
        return undefined;
      }

      const updated = await updateRole(tx, id, {
        name: input.name,
        description: input.description,
      });

      if (!updated) {
        return undefined;
      }

      const permissionChange =
        input.permissionKeys === undefined
          ? null
          : await setRolePermissions(tx, id, input.permissionKeys);

      await this.audit.record(tx, {
        action: "roles.updated",
        resourceType: "role",
        resourceId: updated.id,
        actorUserId: actor.userId,
        detail: {
          changed: Object.keys(input).sort(),
          ...(before.name === updated.name ? {} : { name: { from: before.name, to: updated.name } }),
          ...(permissionChange
            ? { permissionsRemoved: permissionChange.removed, permissionsAdded: permissionChange.added }
            : {}),
        },
        ip: actor.ip,
      });

      return updated;
    });
  }

  async archive(actor: Actor, id: string): Promise<Role | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const before = await findRoleById(tx, id);

      if (!before) {
        return undefined;
      }

      const archived = await archiveRole(tx, id);

      if (!archived) {
        return undefined;
      }

      await this.audit.record(tx, {
        action: "roles.archived",
        resourceType: "role",
        resourceId: archived.id,
        actorUserId: actor.userId,
        detail: { name: archived.name, alreadyArchived: before.archivedAt !== null },
        ip: actor.ip,
      });

      return archived;
    });
  }

  /**
   * Replaces a user's roles. The audit entry is filed against the *user* —
   * "what happened to this person's access" is the question it answers — and
   * records the role ids removed and added, so a later reader can see exactly
   * which grant appeared or vanished and when.
   */
  async setUserRoles(
    actor: Actor,
    userId: string,
    roleIds: string[],
  ): Promise<{ removed: string[]; added: string[] } | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const user = await findUserById(tx, userId);

      if (!user) {
        return undefined;
      }

      const change = await setUserRoles(tx, userId, roleIds);

      await this.audit.record(tx, {
        action: "users.roles_changed",
        resourceType: "user",
        resourceId: userId,
        actorUserId: actor.userId,
        detail: {
          rolesRemoved: change.removed,
          rolesAdded: change.added,
          self: userId === actor.userId,
        },
        ip: actor.ip,
      });

      return change;
    });
  }
}

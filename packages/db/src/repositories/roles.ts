import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  permissionResources,
  permissions,
} from "../schema/permissions.js";
import { rolePermissions, roles, userRoles } from "../schema/roles.js";
import { users } from "../schema/users.js";
import { currentFirmId, type TenantTransaction } from "../tenant-context.js";
import type {
  Permission,
  PermissionKey,
  PermissionResource,
} from "../schema/permissions.js";
import type { Role } from "../schema/roles.js";

/**
 * Roles and their permissions.
 *
 * Two shapes of table live here and they behave differently on purpose.
 * `roles` is a record — archived, never deleted, so a role named in the audit
 * trail stays nameable. `role_permissions` and `user_roles` are configuration,
 * and they are the only tenant tables in this schema that grant DELETE:
 * revoking a permission means removing the row, and the *history* of that
 * change lives in the audit log rather than in a tombstone
 * (docs/decisions/0004-permissions.md).
 *
 * ── The last administrator ───────────────────────────────────────────────────
 *
 * Nothing here checks that a firm keeps someone holding `roles.manage`.
 * Migration 0015 does, as deferred constraint triggers that run at commit, so a
 * transaction that ends with no administrator is refused with SQLSTATE 'LA001'
 * whatever path it took — this code, a script, or psql. The functions below
 * are written to make the *ordinary* edits single transactions, which is what
 * lets "move the only administrator to a different role" succeed: checked at
 * commit, not half way through.
 */

export type {
  Permission,
  PermissionKey,
  PermissionResource,
} from "../schema/permissions.js";
export type { NewRole, Role } from "../schema/roles.js";

/** Raised by the triggers in 0015 when a firm would lose its last administrator. */
export const PG_LAST_ADMINISTRATOR = "LA001";

export interface PermissionGroup extends PermissionResource {
  permissions: Permission[];
}

/**
 * The whole catalogue, grouped by resource in display order, with the Arabic
 * labels a role editor shows.
 *
 * Global reference data with no `firm_id` and no row-level security — there is
 * no tenant dimension to scope by, and the application holds no INSERT or
 * UPDATE on it, which is what makes it read-only. Every firm sees the same
 * list; what differs is which of these keys their roles carry.
 */
export async function listPermissionGroups(
  tx: TenantTransaction,
): Promise<PermissionGroup[]> {
  const resources = await tx
    .select()
    .from(permissionResources)
    .orderBy(asc(permissionResources.sortOrder));

  const all = await tx.select().from(permissions).orderBy(asc(permissions.key));

  return resources.map((resource) => ({
    ...resource,
    permissions: all.filter((p) => p.resource === resource.resource),
  }));
}

/** Flat, for callers that only need the keys — the seed script. */
export async function listPermissions(
  tx: TenantTransaction,
): Promise<Permission[]> {
  return tx.select().from(permissions).orderBy(asc(permissions.key));
}

export interface RoleWithDetails extends Role {
  permissionKeys: PermissionKey[];
  /** Active users holding the role. Disabled colleagues are not counted. */
  userCount: number;
}

/**
 * Every role with its permission set and how many people hold it.
 *
 * Three queries, not one: a role with no permissions and no holders is a
 * legitimate row that a join-and-aggregate would either drop or need outer
 * joins and `filter` clauses to keep. Grouping in application code over three
 * plain reads is simpler to see is right.
 *
 * Archived roles are included and marked. They are still named on old
 * assignments and in the audit trail, and the roles screen should be able to
 * show one rather than have it vanish.
 */
export async function listRoles(
  tx: TenantTransaction,
): Promise<RoleWithDetails[]> {
  const all = await tx.select().from(roles).orderBy(asc(roles.name));

  const grants = await tx
    .select({ roleId: rolePermissions.roleId, key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .orderBy(asc(rolePermissions.permissionKey));

  // Only active holders. A disabled colleague still has the row — attribution
  // survives — but is not someone the role currently empowers.
  const holders = await tx
    .select({ roleId: userRoles.roleId, value: count() })
    .from(userRoles)
    .innerJoin(
      users,
      and(
        eq(users.firmId, userRoles.firmId),
        eq(users.id, userRoles.userId),
        isNull(users.disabledAt),
      ),
    )
    .groupBy(userRoles.roleId);

  const holderCount = new Map(holders.map((h) => [h.roleId, h.value]));

  return all.map((role) => ({
    ...role,
    permissionKeys: grants
      .filter((g) => g.roleId === role.id)
      .map((g) => g.key as PermissionKey),
    userCount: holderCount.get(role.id) ?? 0,
  }));
}

export async function findRoleById(
  tx: TenantTransaction,
  id: string,
): Promise<Role | undefined> {
  const [row] = await tx.select().from(roles).where(eq(roles.id, id)).limit(1);
  return row;
}

/**
 * Names are unique within a firm, so this resolves at most one role. Another
 * firm's role of the same name is invisible here, which is why two firms can
 * both have a "مدير المكتب" without either being able to observe the other's.
 */
export async function findRoleByName(
  tx: TenantTransaction,
  name: string,
): Promise<Role | undefined> {
  const [row] = await tx
    .select()
    .from(roles)
    .where(eq(roles.name, name))
    .limit(1);

  return row;
}

export interface CreateRoleInput {
  name: string;
  description?: string | null;
}

/** `firm_id` comes from the tenant context, never from the caller. */
export async function createRole(
  tx: TenantTransaction,
  input: CreateRoleInput,
): Promise<Role> {
  const firmId = await currentFirmId(tx);

  const [row] = await tx
    .insert(roles)
    .values({
      firmId,
      name: input.name,
      description: input.description ?? null,
    })
    .returning();

  if (!row) {
    throw new Error("createRole: insert returned no row");
  }

  return row;
}

export interface UpdateRoleInput {
  name?: string | undefined;
  description?: string | null | undefined;
}

export async function updateRole(
  tx: TenantTransaction,
  id: string,
  input: UpdateRoleInput,
): Promise<Role | undefined> {
  const values = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );

  if (Object.keys(values).length === 0) {
    return findRoleById(tx, id);
  }

  const [row] = await tx
    .update(roles)
    .set(values)
    .where(eq(roles.id, id))
    .returning();

  return row;
}

/**
 * Archives a role. Idempotent; the first timestamp wins. A role that is the
 * only path to `roles.manage` for the firm's only administrator is refused by
 * the trigger at commit.
 */
export async function archiveRole(
  tx: TenantTransaction,
  id: string,
): Promise<Role | undefined> {
  const [row] = await tx
    .update(roles)
    .set({ archivedAt: sql`coalesce(${roles.archivedAt}, now())` })
    .where(eq(roles.id, id))
    .returning();

  return row;
}

export async function listRolePermissions(
  tx: TenantTransaction,
  roleId: string,
): Promise<PermissionKey[]> {
  const rows = await tx
    .select({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId))
    .orderBy(asc(rolePermissions.permissionKey));

  return rows.map((row) => row.key as PermissionKey);
}

/**
 * Grants permissions to a role, ignoring any it already holds.
 *
 * `onConflictDoNothing` against the primary key, rather than reading the
 * current set and inserting the difference. The read-then-write version has a
 * race — two callers both see a permission missing and both insert it — that
 * the constraint would turn into an error at exactly the moment two
 * administrators edit the same role. Letting the database resolve it means
 * granting twice is simply not an event.
 */
export async function grantPermissionsToRole(
  tx: TenantTransaction,
  roleId: string,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) {
    return;
  }

  const firmId = await currentFirmId(tx);

  await tx
    .insert(rolePermissions)
    .values(keys.map((key) => ({ firmId, roleId, permissionKey: key })))
    .onConflictDoNothing();
}

/**
 * Replaces a role's permission set with exactly `keys`.
 *
 * Delete-then-insert rather than a computed diff. The diff is what a caller
 * would write to be clever, and it is where the mistakes live: a key present in
 * both sets deleted by accident, a key in neither inserted. Deleting everything
 * and inserting the target set cannot express the wrong state, and the two
 * statements are one transaction — so the trigger that guards the last
 * administrator sees only the end result, not the empty middle.
 *
 * Returns the keys removed and added, for the audit entry. Recording both is
 * what makes "who took `cases.assign` away from the paralegals, and when"
 * answerable later.
 */
export async function setRolePermissions(
  tx: TenantTransaction,
  roleId: string,
  keys: readonly string[],
): Promise<{ removed: string[]; added: string[] }> {
  const before = new Set<string>(await listRolePermissions(tx, roleId));
  const after = new Set<string>(keys);

  await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  await grantPermissionsToRole(tx, roleId, keys);

  return {
    removed: [...before].filter((key) => !after.has(key)).sort(),
    added: [...after].filter((key) => !before.has(key)).sort(),
  };
}

/**
 * Assigns a role to a user. Idempotent for the same reason as above, and
 * doubly protected by composite foreign keys: the user and the role must both
 * belong to the firm whose context this runs in.
 */
export async function assignRoleToUser(
  tx: TenantTransaction,
  userId: string,
  roleId: string,
): Promise<void> {
  const firmId = await currentFirmId(tx);

  await tx
    .insert(userRoles)
    .values({ firmId, userId, roleId })
    .onConflictDoNothing();
}

/**
 * Replaces a user's roles with exactly `roleIds`. Same shape and same reasoning
 * as `setRolePermissions`; same guard at commit.
 */
export async function setUserRoles(
  tx: TenantTransaction,
  userId: string,
  roleIds: readonly string[],
): Promise<{ removed: string[]; added: string[] }> {
  const firmId = await currentFirmId(tx);

  const current = await tx
    .select({ roleId: userRoles.roleId })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));

  const before = new Set(current.map((row) => row.roleId));
  const after = new Set(roleIds);

  await tx.delete(userRoles).where(eq(userRoles.userId, userId));

  if (roleIds.length > 0) {
    await tx
      .insert(userRoles)
      .values(roleIds.map((roleId) => ({ firmId, userId, roleId })))
      .onConflictDoNothing();
  }

  return {
    removed: [...before].filter((id) => !after.has(id)).sort(),
    added: [...after].filter((id) => !before.has(id)).sort(),
  };
}

export interface RoleAssignment {
  userId: string;
  roleId: string;
}

/**
 * Who holds what, for the whole firm, as pairs. One query for the users screen
 * to join against the directory, rather than a request per person.
 *
 * Archived roles are excluded: the assignment row survives archiving so the
 * audit trail can say who held the role, but it no longer confers anything and
 * should not be shown as a current role.
 */
export async function listRoleAssignments(
  tx: TenantTransaction,
): Promise<RoleAssignment[]> {
  return tx
    .select({ userId: userRoles.userId, roleId: userRoles.roleId })
    .from(userRoles)
    .innerJoin(
      roles,
      and(eq(roles.firmId, userRoles.firmId), eq(roles.id, userRoles.roleId)),
    )
    .where(isNull(roles.archivedAt));
}

/** True when any of `roleIds` carries `roles.manage`, ignoring archived roles. */
export async function anyRoleGrantsAdministration(
  tx: TenantTransaction,
  roleIds: readonly string[],
): Promise<boolean> {
  if (roleIds.length === 0) return false;

  const [row] = await tx
    .select({ value: count() })
    .from(rolePermissions)
    .innerJoin(
      roles,
      and(
        eq(roles.firmId, rolePermissions.firmId),
        eq(roles.id, rolePermissions.roleId),
      ),
    )
    .where(
      and(
        inArray(rolePermissions.roleId, [...roleIds]),
        eq(rolePermissions.permissionKey, "roles.manage"),
        isNull(roles.archivedAt),
      ),
    );

  return (row?.value ?? 0) > 0;
}

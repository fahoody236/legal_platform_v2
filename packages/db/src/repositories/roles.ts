import { asc, eq } from "drizzle-orm";
import { permissions } from "../schema/permissions.js";
import { rolePermissions, roles, userRoles } from "../schema/roles.js";
import { currentFirmId, type TenantTransaction } from "../tenant-context.js";
import type { Permission, PermissionKey } from "../schema/permissions.js";
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
 * Nothing here revokes yet. These functions were added for the development seed
 * and cover only what it needs — reading the catalogue, and granting. A roles
 * API will need `revokePermissionFromRole` and `unassignRole` to go with them.
 */

export type { Permission, PermissionKey } from "../schema/permissions.js";
export type { Role, NewRole } from "../schema/roles.js";

/**
 * The whole permission catalogue.
 *
 * Global reference data with no `firm_id` and no row-level security — there is
 * no tenant dimension to scope by, and the application holds no INSERT or
 * UPDATE on it, which is what makes it read-only. Every firm sees the same
 * list; what differs is which of these keys their roles carry.
 */
export async function listPermissions(
  tx: TenantTransaction,
): Promise<Permission[]> {
  return tx.select().from(permissions).orderBy(asc(permissions.key));
}

export async function listRoles(tx: TenantTransaction): Promise<Role[]> {
  return tx.select().from(roles).orderBy(asc(roles.name));
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
 *
 * The composite foreign key to `roles (firm_id, id)` means a role belonging to
 * another firm cannot be granted anything from here: the pair does not exist in
 * the parent, so the write fails rather than crossing the boundary.
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

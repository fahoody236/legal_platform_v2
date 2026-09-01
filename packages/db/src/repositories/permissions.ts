import { and, eq, isNull } from "drizzle-orm";
import { rolePermissions, roles, userRoles } from "../schema/roles.js";
import type { TenantTransaction } from "../tenant-context.js";

/**
 * Re-exported so callers can name a permission without importing the table the
 * catalogue lives in. `PermissionKey` is what makes `@RequirePermission` a
 * compile-time check: a misspelled key is a type error rather than a route that
 * quietly returns 403 forever, because nothing can ever hold a key that no row
 * in `permissions` defines.
 */
export { PERMISSION_KEYS } from "../schema/permissions.js";
export type { Permission, PermissionKey } from "../schema/permissions.js";

/**
 * Every permission the user holds, from every role they hold, as one query.
 *
 * The union is computed in the database rather than by loading roles and
 * folding them in application code — partly for the round trip, mostly because
 * the fold is where a mistake would be invisible. `selectDistinct` collapses the
 * overlap when two roles carry the same permission.
 *
 * Archived roles contribute nothing. Retiring a role has to actually remove the
 * access it granted, or `archived_at` would be a label rather than a control;
 * this is the query that makes it one. The assignments in `user_roles` survive,
 * which is what lets the audit trail still say who held it and when.
 *
 * The tenant policies supply `firm_id` on all three tables, so this reads only
 * the caller's firm even though no WHERE clause says so. The join conditions
 * name `firm_id` anyway: it costs nothing, it matches the composite keys the
 * tables are actually built on, and a reader should not have to know the policy
 * text to see that a row from another firm cannot enter this result.
 */
export async function listEffectivePermissions(
  tx: TenantTransaction,
  userId: string,
): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ key: rolePermissions.permissionKey })
    .from(userRoles)
    .innerJoin(
      roles,
      and(eq(roles.firmId, userRoles.firmId), eq(roles.id, userRoles.roleId)),
    )
    .innerJoin(
      rolePermissions,
      and(
        eq(rolePermissions.firmId, userRoles.firmId),
        eq(rolePermissions.roleId, userRoles.roleId),
      ),
    )
    .where(and(eq(userRoles.userId, userId), isNull(roles.archivedAt)));

  return rows.map((row) => row.key);
}

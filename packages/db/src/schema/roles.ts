import {
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { firms } from "./firms.js";
import { permissions } from "./permissions.js";
import { users } from "./users.js";

/**
 * A named set of permissions, owned by one firm.
 *
 * The platform imposes no hierarchy: roles are flat, and a firm expresses
 * seniority by choosing which permissions to group together rather than by
 * ranking roles against each other (docs/decisions/0004-permissions.md).
 *
 * Retired with `archived_at` rather than deleted, so a role that appears in the
 * audit trail can still be named years later.
 */
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    // The anchor for every composite reference to a role.
    unique("roles_firm_id_id_key").on(t.firmId, t.id),
    // Unique within a firm, not across the platform: two firms may both have a
    // role called "شريك".
    unique("roles_firm_id_name_key").on(t.firmId, t.name),
  ],
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;

/**
 * Which permissions a role carries.
 *
 * `firm_id` is carried here as well as on `roles`, and the foreign key points at
 * `roles (firm_id, id)` rather than `roles (id)`. That is what makes a grant
 * belonging to one firm and a role belonging to another impossible to express —
 * the pair must exist together in the parent.
 */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    firmId: uuid("firm_id").notNull(),
    roleId: uuid("role_id").notNull(),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key),
  },
  (t) => [
    primaryKey({
      name: "role_permissions_pkey",
      columns: [t.firmId, t.roleId, t.permissionKey],
    }),
    foreignKey({
      columns: [t.firmId, t.roleId],
      foreignColumns: [roles.firmId, roles.id],
    }),
    // "Which roles carry this permission" — half of the effective-permission
    // lookup on every request, and of the last-administrator question.
    index("role_permissions_firm_id_permission_key_idx").on(
      t.firmId,
      t.permissionKey,
    ),
  ],
);

export type RolePermission = typeof rolePermissions.$inferSelect;

/**
 * Which roles a user holds. Effective permissions are the union across them.
 *
 * Composite foreign keys to both parents, for the same reason: a user in firm A
 * cannot be given a role in firm B, whatever identifiers a caller supplies.
 */
export const userRoles = pgTable(
  "user_roles",
  {
    firmId: uuid("firm_id").notNull(),
    userId: uuid("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "user_roles_pkey",
      columns: [t.firmId, t.userId, t.roleId],
    }),
    foreignKey({
      columns: [t.firmId, t.userId],
      foreignColumns: [users.firmId, users.id],
    }),
    foreignKey({
      columns: [t.firmId, t.roleId],
      foreignColumns: [roles.firmId, roles.id],
    }),
    // "Who holds this role" — the question the last-administrator trigger will
    // ask, and the one behind every role-membership screen.
    index("user_roles_firm_id_role_id_idx").on(t.firmId, t.roleId),
  ],
);

export type UserRole = typeof userRoles.$inferSelect;

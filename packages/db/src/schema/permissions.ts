import { pgTable, text } from "drizzle-orm/pg-core";

/**
 * The global permission catalogue — the platform's vocabulary, identical for
 * every firm.
 *
 * No `firm_id` and no row-level security: there is no tenant dimension to scope
 * by. It is read-only to the application by grant, so a firm composes roles from
 * these keys and cannot invent one. Adding a permission is a migration, which is
 * the intended friction — a new key is a new thing the product can express.
 */
export const permissions = pgTable("permissions", {
  /** `resource.action`, e.g. `documents.download`. Stable; code refers to it. */
  key: text("key").primaryKey(),
  resource: text("resource").notNull(),
  action: text("action").notNull(),
  /** Engineering-facing. Arabic interface labels are not designed yet. */
  description: text("description").notNull(),
});

export type Permission = typeof permissions.$inferSelect;

/**
 * The keys seeded by migrations 0008 and 0010, as a type. Mirrors the migrations
 * rather
 * than generating it — the database is the source of truth, and the foreign key
 * from `role_permissions` is what actually enforces that a grant names a real
 * permission. This exists so application code referring to a key is checked at
 * compile time instead of failing on a constraint at run time.
 */
export const PERMISSION_KEYS = [
  // 0008 — the platform's own administration.
  "firms.view",
  "firms.manage",
  "users.view",
  "users.manage",
  "roles.view",
  "roles.manage",
  // 0010 — clients and matters.
  "clients.view",
  "clients.manage",
  "cases.view",
  "cases.create",
  "cases.edit",
  "cases.assign",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

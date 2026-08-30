import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Subdomains the platform needs for itself, and which therefore cannot be
 * assigned to a firm. Mirrored by a CHECK constraint in migration 0006 — this
 * copy exists so the application can reject one with a useful message before
 * the database does it with a constraint violation.
 */
export const RESERVED_SUBDOMAINS = [
  "www",
  "api",
  "admin",
  "app",
  "mail",
  "static",
  "assets",
] as const;

/**
 * A subscribing law firm — the tenant, and the boundary every other table is
 * scoped to.
 *
 * There is no delete. A firm that stops subscribing gets `archived_at` set,
 * which removes it from active views while every record it holds stays intact.
 * Legal records outlive the commercial relationship, and the threat model
 * treats destruction as an attack rather than a feature.
 *
 * This table carries no `firm_id`, so it has no `UNIQUE (firm_id, id)` the way
 * tenant-owned tables do — its own `id` is the tenant key. The primary key is
 * already the anchor every `firm_id uuid REFERENCES firms (id)` points at.
 */
export const firms = pgTable(
  "firms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Latin-script name, for URLs, invoices, and English-language contexts. */
    name: text("name").notNull(),
    /** Arabic legal name — the name users actually see. */
    nameAr: text("name_ar").notNull(),
    /**
     * The firm's host label: `alhumoudi` in `alhumoudi.platform.sa`. Resolves a
     * request to a tenant before any query runs, which is why login needs no
     * exception to the isolation model
     * (docs/decisions/0003-tenant-identification.md).
     */
    subdomain: text("subdomain").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set to archive. Never a tombstone for deleted data — the data remains. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    // Global, not per firm. This is the value that establishes which tenant a
    // request belongs to, so scoping it by tenant would be circular.
    unique("firms_subdomain_key").on(t.subdomain),

    // 3–63 characters, lowercase letters, digits and hyphens, never starting or
    // ending with a hyphen. The three groups give the bounds: 1 + (1..61) + 1.
    check(
      "firms_subdomain_format_check",
      sql`${t.subdomain} ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'`,
    ),

    check(
      "firms_subdomain_not_reserved_check",
      sql`${t.subdomain} not in ('www', 'api', 'admin', 'app', 'mail', 'static', 'assets')`,
    ),
  ],
);

export type Firm = typeof firms.$inferSelect;
export type NewFirm = typeof firms.$inferInsert;

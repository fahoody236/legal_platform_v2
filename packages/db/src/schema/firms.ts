import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
export const firms = pgTable("firms", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Latin-script name, for URLs, invoices, and English-language contexts. */
  name: text("name").notNull(),
  /** Arabic legal name — the name users actually see. */
  nameAr: text("name_ar").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** Set to archive. Never a tombstone for deleted data — the data remains. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export type Firm = typeof firms.$inferSelect;
export type NewFirm = typeof firms.$inferInsert;

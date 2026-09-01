import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { firms } from "./firms.js";

/**
 * A client of one firm.
 *
 * Archived, never deleted. A former client's matters stay readable, and the
 * client record is what makes them legible years later — removing it would
 * leave a case attached to an identifier nobody can resolve.
 *
 * Clients are not shared between firms even when they are the same person or
 * company in the world. Two firms acting for the same client hold two records,
 * because a shared one would be a cross-tenant object by construction: every
 * edit, every note, and the mere fact of the relationship would be visible
 * across the boundary.
 */
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    /** Latin-script name. */
    name: text("name").notNull(),
    /** Arabic name. Optional: a foreign corporate client may have none. */
    nameAr: text("name_ar"),
    /** Saudi national ID or iqama. Absent for companies, and often at first. */
    nationalId: text("national_id"),
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set to archive. The client's cases remain intact and readable. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    // The anchor for every composite reference to a client — currently cases,
    // later documents, invoices and contracts.
    unique("clients_firm_id_id_key").on(t.firmId, t.id),
  ],
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;

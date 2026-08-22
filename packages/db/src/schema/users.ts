import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { firms } from "./firms.js";

/**
 * A person who works at one firm.
 *
 * There is no delete. Someone who leaves gets `disabled_at` set: they can no
 * longer sign in, while everything they created, uploaded, or was assigned
 * stays attributed to them. Deleting the user would silently rewrite the
 * history of every matter they touched.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    email: text("email").notNull(),
    /** Latin-script name. */
    fullName: text("full_name").notNull(),
    /** Arabic name. Optional only because not every user has one recorded. */
    fullNameAr: text("full_name_ar"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set to revoke access. The person's history remains readable. */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (t) => [
    // Unique per firm, not globally. Two firms may legitimately employ people
    // reachable at the same address — an of-counsel lawyer working with both, or
    // a shared clerk. A global constraint would make one firm's user directory
    // able to block the other's, which is itself a cross-tenant effect.
    //
    // Case-insensitive, over lower(email) rather than a lowercased column, so
    // the address stays stored as the person wrote it. Lookups must match the
    // expression — `where lower(email) = lower($1)` — or they will not use this
    // index and will also disagree with it about what counts as a duplicate.
    uniqueIndex("users_firm_id_lower_email_key").on(
      t.firmId,
      sql`lower(${t.email})`,
    ),

    // The target for composite foreign keys from later tenant-owned tables:
    // `FOREIGN KEY (firm_id, assigned_user_id) REFERENCES users (firm_id, id)`.
    // Pointing at (firm_id, id) rather than at id alone means a row cannot
    // reference a user belonging to another firm — the reference is unrepresentable
    // rather than merely unlikely, so it does not depend on a check being written.
    unique("users_firm_id_id_key").on(t.firmId, t.id),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

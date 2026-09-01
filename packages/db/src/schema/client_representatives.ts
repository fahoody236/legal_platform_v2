import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { clients } from "./clients.js";
import { firms } from "./firms.js";

/**
 * A named person who acts for a company client — a general manager, an
 * authorised signatory, an in-house counsel who instructs the firm.
 *
 * They are not clients. The company is the client; these are the people through
 * whom it speaks, and the record of who may give instructions.
 *
 * **Only companies have representatives, and the database enforces it.** Not
 * with a trigger, and not in application code: the foreign key references
 * `clients (firm_id, id, client_type)` and this table CHECKs that its own
 * `client_type` is `'company'`, so a representative of an individual cannot be
 * written down. Same mechanism the schema already uses for tenancy — a
 * cross-firm reference is impossible because `firm_id` is part of the key.
 *
 * It holds in both directions for free: changing a client from company to
 * individual while representatives exist breaks the referenced triple, so
 * PostgreSQL refuses the update. Migration 0011 carries the full argument,
 * including why the trigger version needs two objects kept in step and this
 * needs none.
 *
 * Archived, never deleted. Someone who leaves the company stops appearing in
 * active views while the contracts they signed stay attributable to a name.
 */
export const clientRepresentatives = pgTable(
  "client_representatives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    clientId: uuid("client_id").notNull(),
    /**
     * Always `'company'`. Less a fact about this row than the mechanism tying
     * it to a company client — it cannot drift, because the foreign key
     * requires it to equal the parent's value.
     */
    clientType: text("client_type").notNull(),
    /** Arabic name — required, as everywhere a person or client is named. */
    nameAr: text("name_ar").notNull(),
    name: text("name"),
    /**
     * Nullable, unlike an individual client's. A firm often knows who signs
     * before it holds their ID, and conflicts are checked against the company's
     * registration, not this.
     */
    nationalId: text("national_id"),
    /** What they are authorised to do. Required: it is why they are recorded. */
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    // Tenant safety and the company-only rule in one constraint. There is
    // deliberately no second FK on (firm_id, client_id): it would be implied by
    // this one and would only add an index to maintain.
    foreignKey({
      columns: [t.firmId, t.clientId, t.clientType],
      foreignColumns: [clients.firmId, clients.id, clients.clientType],
    }),

    check(
      "client_representatives_client_type_check",
      sql`${t.clientType} = 'company'`,
    ),

    // The same rule as an individual client's national_id: it is the same
    // number, and validating it in one table but not the other would make the
    // stored form depend on which screen it was typed into.
    check(
      "client_representatives_national_id_format_check",
      sql`${t.nationalId} ~ '^[12][0-9]{9}$'`,
    ),

    // "Who represents this client" — the only way this table is read.
    index("client_representatives_firm_id_client_id_idx").on(
      t.firmId,
      t.clientId,
    ),

    // No unique index on national_id, deliberately: one person can represent
    // several companies a firm acts for, and often does.
  ],
);

export type ClientRepresentative = typeof clientRepresentatives.$inferSelect;
export type NewClientRepresentative =
  typeof clientRepresentatives.$inferInsert;

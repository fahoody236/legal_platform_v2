import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { clients } from "./clients.js";
import { firms } from "./firms.js";
import { users } from "./users.js";

/**
 * The statuses a matter can be in.
 *
 * A CHECK constraint in the database rather than a PostgreSQL enum, because
 * this list is firm workflow and will change — and an enum value cannot be
 * dropped or renamed at all, only escaped by rewriting the type. Migration 0010
 * carries the full argument.
 *
 * This copy is mirrored by hand, like RESERVED_SUBDOMAINS. The database stays
 * the authority; this exists so the application can reject a bad value with a
 * message rather than a constraint violation, and so a status string is checked
 * at compile time.
 */
export const CASE_STATUSES = [
  "open",
  "in_progress",
  "pending",
  "closed",
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

/**
 * A matter.
 *
 * Archived, never deleted, and closed is not archived: `closed_at` records that
 * the work finished, `archived_at` that the record is out of active views. A
 * case reopened after closing is an ordinary event and needs `closed_at`
 * cleared, not a new row.
 *
 * Both references out of this table are composite — the client by
 * (firm_id, client_id), the lawyer by (firm_id, assigned_lawyer_id) — so a case
 * cannot name another firm's client or another firm's lawyer. That is the
 * property worth the most here: this is the table where a cross-tenant
 * reference would attach privileged work to the wrong firm.
 */
export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    clientId: uuid("client_id").notNull(),
    /** The firm's own file reference. Unique within the firm, not globally. */
    caseNumber: text("case_number").notNull(),
    /** Arabic title — the required one, and what users actually read. */
    titleAr: text("title_ar").notNull(),
    /** Latin-script title. Optional, like the client's Latin name. */
    title: text("title"),
    caseType: text("case_type").notNull(),
    /** Null for advisory work and anything else with no forum. */
    court: text("court"),
    status: text("status").$type<CaseStatus>().notNull(),
    /** Null while unassigned, which is a real state and a queryable one. */
    assignedLawyerId: uuid("assigned_lawyer_id"),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set when the work finishes. Cleared if the matter reopens. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set to archive. Distinct from closing — see the note above. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    // The anchor for later composite references — documents, time entries,
    // invoices all hang off a case.
    unique("cases_firm_id_id_key").on(t.firmId, t.id),
    unique("cases_firm_id_case_number_key").on(t.firmId, t.caseNumber),

    foreignKey({
      columns: [t.firmId, t.clientId],
      foreignColumns: [clients.firmId, clients.id],
    }),
    foreignKey({
      columns: [t.firmId, t.assignedLawyerId],
      foreignColumns: [users.firmId, users.id],
    }),

    check(
      "cases_status_check",
      sql`${t.status} in ('open', 'in_progress', 'pending', 'closed')`,
    ),

    index("cases_firm_id_client_id_idx").on(t.firmId, t.clientId),
    index("cases_firm_id_assigned_lawyer_id_idx").on(
      t.firmId,
      t.assignedLawyerId,
    ),
    index("cases_firm_id_status_idx").on(t.firmId, t.status),
  ],
);

export type Case = typeof cases.$inferSelect;
export type NewCase = typeof cases.$inferInsert;

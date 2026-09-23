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
import { cases } from "./cases.js";
import { firms } from "./firms.js";
import { users } from "./users.js";

/** Mirrored by hand from migration 0017. The database is the authority. */
export const HEARING_TYPES = [
  "pleading",
  "judgment",
  "appeal",
  "expert",
  "other",
] as const;

export type HearingType = (typeof HEARING_TYPES)[number];

export const HEARING_STATUSES = [
  "scheduled",
  "held",
  "adjourned",
  "cancelled",
] as const;

export type HearingStatus = (typeof HEARING_STATUSES)[number];

/**
 * A court date on a matter.
 *
 * No attendee: the lawyer assigned to the case attends, and that fact has one
 * home on `cases.assigned_lawyer_id` rather than a second copy here that
 * nothing keeps in step.
 *
 * `court` is null when the hearing sits in the case's own court, which is the
 * ordinary situation; a value means somewhere else, as on referral or appeal.
 *
 * Adjournment is two rows — this one becomes `adjourned` and a successor is
 * created — and the pairing is the API's, not the database's. See 0017 for
 * why a trigger would be wrong rather than merely expensive.
 */
export const hearings = pgTable(
  "hearings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    caseId: uuid("case_id").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    /** Null means the case's own court. */
    court: text("court"),
    /** الدائرة — the circuit or chamber within the court. */
    circuit: text("circuit"),
    hearingType: text("hearing_type").$type<HearingType>().notNull(),
    status: text("status").$type<HearingStatus>().notNull(),
    /** What happened. Null while the hearing is still ahead. */
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    unique("hearings_firm_id_id_key").on(t.firmId, t.id),

    foreignKey({
      columns: [t.firmId, t.caseId],
      foreignColumns: [cases.firmId, cases.id],
    }),
    foreignKey({
      columns: [t.firmId, t.createdByUserId],
      foreignColumns: [users.firmId, users.id],
    }),

    check(
      "hearings_hearing_type_check",
      sql`${t.hearingType} in ('pleading', 'judgment', 'appeal', 'expert', 'other')`,
    ),
    check(
      "hearings_status_check",
      sql`${t.status} in ('scheduled', 'held', 'adjourned', 'cancelled')`,
    ),

    index("hearings_firm_id_case_id_scheduled_at_idx").on(
      t.firmId,
      t.caseId,
      t.scheduledAt,
    ),
  ],
);

export type Hearing = typeof hearings.$inferSelect;
export type NewHearing = typeof hearings.$inferInsert;

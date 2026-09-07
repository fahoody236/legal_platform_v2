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

/** Mirrored by hand from migration 0012. The database is the authority. */
export const TASK_STATUSES = [
  "open",
  "in_progress",
  "done",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * A unit of work on a matter.
 *
 * Always belongs to a case: `case_id` is NOT NULL, and a task without a matter
 * would be a note whose place in the product nobody has decided.
 *
 * `status = 'done'` and `completed_at` are inseparable, enforced by
 * `tasks_completed_at_matches_status_check`. That constraint is why completion
 * is its own operation rather than a value on an edit form — see 0012.
 *
 * Cancelled rather than deleted, archived rather than removed. A task records
 * that work was asked for, which stays true even when the answer turns out to
 * be "not any more".
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    caseId: uuid("case_id").notNull(),
    /** Arabic title — the required one, as everywhere since 0011. */
    titleAr: text("title_ar").notNull(),
    title: text("title"),
    description: text("description"),
    /** Null while nobody has picked it up, which is a queryable state. */
    assignedToUserId: uuid("assigned_to_user_id"),
    status: text("status").$type<TaskStatus>().notNull(),
    priority: text("priority").$type<TaskPriority>().notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    /** Set only when `status` is `done`, and never otherwise. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    unique("tasks_firm_id_id_key").on(t.firmId, t.id),

    foreignKey({
      columns: [t.firmId, t.caseId],
      foreignColumns: [cases.firmId, cases.id],
    }),
    foreignKey({
      columns: [t.firmId, t.assignedToUserId],
      foreignColumns: [users.firmId, users.id],
    }),
    foreignKey({
      columns: [t.firmId, t.createdByUserId],
      foreignColumns: [users.firmId, users.id],
    }),

    check(
      "tasks_status_check",
      sql`${t.status} in ('open', 'in_progress', 'done', 'cancelled')`,
    ),
    check(
      "tasks_priority_check",
      sql`${t.priority} in ('low', 'normal', 'high')`,
    ),
    check(
      "tasks_completed_at_matches_status_check",
      sql`(${t.status} = 'done') = (${t.completedAt} is not null)`,
    ),

    index("tasks_firm_id_case_id_idx").on(t.firmId, t.caseId),
    index("tasks_firm_id_assigned_to_user_id_status_idx").on(
      t.firmId,
      t.assignedToUserId,
      t.status,
    ),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

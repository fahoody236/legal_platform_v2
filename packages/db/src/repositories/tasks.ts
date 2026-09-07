import { and, count, desc, eq, getTableColumns, isNull, lt, sql } from "drizzle-orm";
import { cases } from "../schema/cases.js";
import { tasks } from "../schema/tasks.js";
import { users } from "../schema/users.js";
import { currentFirmId, type TenantTransaction } from "../tenant-context.js";
import type { Task, TaskPriority, TaskStatus } from "../schema/tasks.js";

export { TASK_PRIORITIES, TASK_STATUSES } from "../schema/tasks.js";
export type { NewTask, Task, TaskPriority, TaskStatus } from "../schema/tasks.js";

/**
 * A task with the references it is read alongside.
 *
 * The case title is here because a task list outside a case page is unreadable
 * without it, and the assignee's name for the same reason the cases list
 * carries the lawyer's. Both widen what `tasks.view` discloses; both are the
 * minimum that makes the screen usable.
 */
export interface TaskWithNames extends Task {
  caseNumber: string;
  caseTitleAr: string;
  /** Null when unassigned. Arabic name where recorded, Latin otherwise. */
  assignedToName: string | null;
}

const taskWithNamesColumns = {
  ...getTableColumns(tasks),
  caseNumber: cases.caseNumber,
  caseTitleAr: cases.titleAr,
  assignedToName: sql<
    string | null
  >`coalesce(${users.fullNameAr}, ${users.fullName})`.as("assigned_to_name"),
};

/*
 * `cases` is an inner join and `users` a left join in every query below — the
 * difference between a column that is NOT NULL and one that is. Every task has
 * a case; an unassigned task is ordinary.
 *
 * Both join conditions name `firm_id` even though the policies already confine
 * all three tables to one firm. It costs nothing and lets a reader see that no
 * other firm's row can enter the result without knowing the policy text.
 */

export interface ListTasksFilters {
  caseId?: string | undefined;
  assignedToUserId?: string | undefined;
  status?: TaskStatus | undefined;
  priority?: TaskPriority | undefined;
  /** Past due and still live. Finished work is never late. */
  overdue?: boolean | undefined;
  includeArchived?: boolean | undefined;
  limit: number;
  offset: number;
}

export interface ListTasksResult {
  items: TaskWithNames[];
  total: number;
}

function filterConditions(filters: ListTasksFilters) {
  return [
    filters.caseId ? eq(tasks.caseId, filters.caseId) : undefined,
    filters.assignedToUserId
      ? eq(tasks.assignedToUserId, filters.assignedToUserId)
      : undefined,
    filters.status ? eq(tasks.status, filters.status) : undefined,
    filters.priority ? eq(tasks.priority, filters.priority) : undefined,
    // Matches the partial index in 0012 exactly — same status set, same
    // archived condition — so the filter can use it. A predicate written any
    // other way would be correct and would scan.
    filters.overdue
      ? and(
          lt(tasks.dueAt, sql`now()`),
          sql`${tasks.status} in ('open', 'in_progress')`,
          isNull(tasks.archivedAt),
        )
      : undefined,
    filters.includeArchived ? undefined : isNull(tasks.archivedAt),
  ].filter((condition) => condition !== undefined);
}

/**
 * A page of the firm's tasks.
 *
 * Ordered by due date with nulls last, then by creation. A list of work sorted
 * by anything else buries what is due tomorrow under what has no date at all —
 * `nulls last` is the whole difference between a useful list and a chronological
 * one.
 *
 * Archived tasks are excluded by default here, unlike `listCases`. The
 * difference is deliberate: a case list is a record of matters and an archived
 * one still belongs in it, while a task list is a list of work to do.
 */
export async function listTasks(
  tx: TenantTransaction,
  filters: ListTasksFilters,
): Promise<ListTasksResult> {
  const conditions = filterConditions(filters);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const items = await tx
    .select(taskWithNamesColumns)
    .from(tasks)
    .innerJoin(
      cases,
      and(eq(cases.firmId, tasks.firmId), eq(cases.id, tasks.caseId)),
    )
    .leftJoin(
      users,
      and(
        eq(users.firmId, tasks.firmId),
        eq(users.id, tasks.assignedToUserId),
      ),
    )
    .where(where)
    .orderBy(sql`${tasks.dueAt} asc nulls last`, desc(tasks.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);

  // No joins on the count: they cannot change it, and including them would only
  // give a future edit somewhere to introduce a row multiplication.
  const [totals] = await tx.select({ value: count() }).from(tasks).where(where);

  return { items, total: totals?.value ?? 0 };
}

export async function findTaskById(
  tx: TenantTransaction,
  id: string,
): Promise<TaskWithNames | undefined> {
  const [row] = await tx
    .select(taskWithNamesColumns)
    .from(tasks)
    .innerJoin(
      cases,
      and(eq(cases.firmId, tasks.firmId), eq(cases.id, tasks.caseId)),
    )
    .leftJoin(
      users,
      and(
        eq(users.firmId, tasks.firmId),
        eq(users.id, tasks.assignedToUserId),
      ),
    )
    .where(eq(tasks.id, id))
    .limit(1);

  return row;
}

export interface CreateTaskInput {
  caseId: string;
  titleAr: string;
  title?: string | null;
  description?: string | null;
  assignedToUserId?: string | null;
  status: Exclude<TaskStatus, "done">;
  priority: TaskPriority;
  dueAt?: Date | null;
  createdByUserId: string;
}

/**
 * `firm_id` comes from the tenant context, never the caller.
 *
 * `status` cannot be `done` at creation, and the type says so. A task created
 * already finished would need `completed_at` in the same breath, and a
 * completion nobody performed is not a record worth having — if the work is
 * already done, create it and complete it, so the audit trail says who.
 */
export async function createTask(
  tx: TenantTransaction,
  input: CreateTaskInput,
): Promise<Task> {
  const firmId = await currentFirmId(tx);

  const [row] = await tx
    .insert(tasks)
    .values({
      firmId,
      caseId: input.caseId,
      titleAr: input.titleAr,
      title: input.title ?? null,
      description: input.description ?? null,
      assignedToUserId: input.assignedToUserId ?? null,
      status: input.status,
      priority: input.priority,
      dueAt: input.dueAt ?? null,
      completedAt: null,
      createdByUserId: input.createdByUserId,
    })
    .returning();

  if (!row) {
    throw new Error("createTask: insert returned no row");
  }

  return row;
}

/**
 * The editable surface of a task.
 *
 * `status` is here but `done` is not reachable through it — see `updateTask`.
 * `assignedToUserId` is absent because assignment is `tasks.assign`, held
 * separately from `tasks.edit`; carrying it here would collapse the two.
 * `caseId` is absent because moving a task to another matter is a re-filing,
 * not a field edit.
 */
export interface UpdateTaskInput {
  titleAr?: string | undefined;
  title?: string | null | undefined;
  description?: string | null | undefined;
  status?: Exclude<TaskStatus, "done"> | undefined;
  priority?: TaskPriority | undefined;
  dueAt?: Date | null | undefined;
  archivedAt?: Date | null | undefined;
}

/**
 * Applies the given fields, or returns undefined if the task is not visible in
 * this tenant context.
 *
 * **Moving a task off `done` clears `completed_at`.** That is not a
 * convenience: the CHECK constraint refuses the row otherwise, so without it a
 * perfectly reasonable "reopen this" would fail with a constraint name. The
 * type forbids setting `done` here, so the reverse case cannot arise — a
 * completion always goes through `completeTask`, which is what puts a
 * `tasks.completed` entry in the audit trail rather than an anonymous edit.
 */
export async function updateTask(
  tx: TenantTransaction,
  id: string,
  input: UpdateTaskInput,
): Promise<Task | undefined> {
  const values: Record<string, unknown> = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );

  if (input.status !== undefined) {
    values["completedAt"] = null;
  }

  if (Object.keys(values).length === 0) {
    const [row] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return row;
  }

  const [row] = await tx
    .update(tasks)
    .set(values)
    .where(eq(tasks.id, id))
    .returning();

  return row;
}

export async function assignTask(
  tx: TenantTransaction,
  id: string,
  userId: string | null,
): Promise<Task | undefined> {
  const [row] = await tx
    .update(tasks)
    .set({ assignedToUserId: userId })
    .where(eq(tasks.id, id))
    .returning();

  return row;
}

/**
 * Marks a task finished, writing the status and the timestamp together.
 *
 * One statement, so the pair the CHECK constraint binds is never briefly
 * inconsistent — not that a constraint would allow it, but because the
 * alternative shape invites a caller to write them separately somewhere else.
 *
 * `coalesce` keeps the first completion time if the task is already done, so
 * pressing the button twice does not quietly restate when the work finished.
 */
export async function completeTask(
  tx: TenantTransaction,
  id: string,
): Promise<Task | undefined> {
  const [row] = await tx
    .update(tasks)
    .set({
      status: "done",
      completedAt: sql`coalesce(${tasks.completedAt}, now())`,
    })
    .where(eq(tasks.id, id))
    .returning();

  return row;
}

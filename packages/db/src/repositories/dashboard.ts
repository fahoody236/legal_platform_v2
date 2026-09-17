import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { auditLog } from "../schema/audit_log.js";
import { cases } from "../schema/cases.js";
import { clientRepresentatives } from "../schema/client_representatives.js";
import { clients } from "../schema/clients.js";
import { tasks } from "../schema/tasks.js";
import { users } from "../schema/users.js";
import type { TenantTransaction } from "../tenant-context.js";
import type { CaseStatus } from "../schema/cases.js";

/**
 * The dashboard's reads.
 *
 * Nothing here names `firm_id` in a WHERE clause; the policies supply it. The
 * joins name it anyway, so a reader can see that no other firm's row can
 * enter a result without knowing the policy text.
 */

/** Active cases only. An archived matter is not on anyone's board. */
export async function countCasesByStatus(
  tx: TenantTransaction,
): Promise<Record<CaseStatus, number>> {
  const rows = await tx
    .select({ status: cases.status, value: count() })
    .from(cases)
    .where(isNull(cases.archivedAt))
    .groupBy(cases.status);

  const counts: Record<CaseStatus, number> = {
    open: 0,
    in_progress: 0,
    pending: 0,
    closed: 0,
  };

  for (const row of rows) {
    counts[row.status] = row.value;
  }

  return counts;
}

export interface MyTaskSummary {
  /** Live and mine: open or in progress, not archived. */
  open: number;
  /** Live, mine, and past due. Finished work is never late. */
  overdue: number;
  /** Live, mine, due within the window and not yet past. */
  dueSoon: number;
}

/**
 * Three numbers from one pass over the table, using `count(*) FILTER`. Each
 * filter restates the "live" condition rather than relying on the WHERE to
 * supply it, so the three cannot drift apart if one is edited.
 */
export async function summariseMyTasks(
  tx: TenantTransaction,
  userId: string,
  dueSoonDays: number,
): Promise<MyTaskSummary> {
  const live = sql`${tasks.status} in ('open', 'in_progress') and ${tasks.archivedAt} is null`;
  const window = sql`make_interval(days => ${dueSoonDays})`;

  const [row] = await tx
    .select({
      open: sql<number>`count(*) filter (where ${live})`.mapWith(Number),
      overdue: sql<number>`count(*) filter (where ${live} and ${tasks.dueAt} < now())`.mapWith(Number),
      dueSoon: sql<number>`count(*) filter (where ${live} and ${tasks.dueAt} >= now() and ${tasks.dueAt} < now() + ${window})`.mapWith(Number),
    })
    .from(tasks)
    .where(eq(tasks.assignedToUserId, userId));

  return row ?? { open: 0, overdue: 0, dueSoon: 0 };
}

export interface UpcomingDeadline {
  caseId: string;
  caseNumber: string;
  caseTitleAr: string;
  /** The nearest live task's due date on this case. */
  dueAt: Date;
  taskId: string;
  taskTitleAr: string;
  taskAssignedToName: string | null;
}

/**
 * Cases with a live task due inside the window, one row per case, carrying the
 * soonest task.
 *
 * "Deadline" here means a task's due date. Cases have no hearing or deadline
 * column of their own; a matter's deadlines are the dated work on it. If
 * hearings are ever modelled as their own thing, this is where they join in.
 *
 * `DISTINCT ON (case_id)` with the order below picks the soonest task per case
 * in one pass, which is what makes this one query rather than a query per case.
 */
export async function listUpcomingDeadlines(
  tx: TenantTransaction,
  days: number,
  limit: number,
): Promise<UpcomingDeadline[]> {
  const window = sql`make_interval(days => ${days})`;

  const rows = await tx.execute<{
    case_id: string;
    case_number: string;
    case_title_ar: string;
    due_at: string;
    task_id: string;
    task_title_ar: string;
    task_assigned_to_name: string | null;
  }>(sql`
    select * from (
      select distinct on (${tasks.caseId})
        ${tasks.caseId} as case_id,
        ${cases.caseNumber} as case_number,
        ${cases.titleAr} as case_title_ar,
        ${tasks.dueAt} as due_at,
        ${tasks.id} as task_id,
        ${tasks.titleAr} as task_title_ar,
        coalesce(${users.fullNameAr}, ${users.fullName}) as task_assigned_to_name
      from ${tasks}
      inner join ${cases}
        on ${cases.firmId} = ${tasks.firmId} and ${cases.id} = ${tasks.caseId}
      left join ${users}
        on ${users.firmId} = ${tasks.firmId} and ${users.id} = ${tasks.assignedToUserId}
      where ${tasks.status} in ('open', 'in_progress')
        and ${tasks.archivedAt} is null
        and ${cases.archivedAt} is null
        and ${tasks.dueAt} >= now()
        and ${tasks.dueAt} < now() + ${window}
      order by ${tasks.caseId}, ${tasks.dueAt} asc
    ) soonest
    order by due_at asc
    limit ${limit}
  `);

  return rows.rows.map((row) => ({
    caseId: row.case_id,
    caseNumber: row.case_number,
    caseTitleAr: row.case_title_ar,
    dueAt: new Date(row.due_at),
    taskId: row.task_id,
    taskTitleAr: row.task_title_ar,
    taskAssignedToName: row.task_assigned_to_name,
  }));
}

export type ActivityResourceType =
  | "case"
  | "client"
  | "task"
  | "client_representative";

export interface ActivityEntry {
  id: string;
  action: string;
  occurredAt: Date;
  /** Null for an unauthenticated event. Never deleted, so otherwise resolves. */
  actorUserId: string | null;
  actorName: string | null;
  actorDisabled: boolean;
  resourceType: string;
  resourceId: string | null;
  detail: unknown;
  /** Whichever of these the resource type selects; the rest are null. */
  caseId: string | null;
  caseNumber: string | null;
  caseTitleAr: string | null;
  clientId: string | null;
  clientNameAr: string | null;
  taskTitleAr: string | null;
  representativeNameAr: string | null;
}

/**
 * The most recent entries about the given resource types, with the actor and
 * the resource resolved in the same query.
 *
 * Four left joins on `resource_type = '…' and id = resource_id`, one per kind of
 * record the feed can describe. Each is a left join because a record's label
 * is a courtesy, not a requirement: the entry is the fact, and it renders even
 * if — against the schema's design — the record it names were gone.
 *
 * `resource_type in (…)` is the permission gate, applied in SQL. A type the
 * caller may not see is not fetched and then hidden; it is never fetched.
 * Auth events have no resource type in this set and never appear here.
 */
export async function listRecentActivity(
  tx: TenantTransaction,
  resourceTypes: ActivityResourceType[],
  limit: number,
): Promise<ActivityEntry[]> {
  if (resourceTypes.length === 0) {
    return [];
  }

  const rows = await tx
    .select({
      id: auditLog.id,
      action: auditLog.action,
      occurredAt: auditLog.createdAt,
      actorUserId: auditLog.actorUserId,
      actorName: sql<string | null>`coalesce(${users.fullNameAr}, ${users.fullName})`,
      actorDisabled: sql<boolean>`${users.disabledAt} is not null`.mapWith(Boolean),
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      detail: auditLog.detail,
      // A task entry links to its case; a representative entry to its client.
      caseId: sql<string | null>`coalesce(${cases.id}, ${tasks.caseId})`,
      caseNumber: cases.caseNumber,
      caseTitleAr: cases.titleAr,
      clientId: sql<string | null>`coalesce(${clients.id}, ${clientRepresentatives.clientId})`,
      clientNameAr: clients.nameAr,
      taskTitleAr: tasks.titleAr,
      representativeNameAr: clientRepresentatives.nameAr,
    })
    .from(auditLog)
    .leftJoin(
      users,
      and(eq(users.firmId, auditLog.firmId), eq(users.id, auditLog.actorUserId)),
    )
    .leftJoin(
      cases,
      and(
        eq(auditLog.resourceType, "case"),
        eq(cases.firmId, auditLog.firmId),
        eq(cases.id, auditLog.resourceId),
      ),
    )
    .leftJoin(
      clients,
      and(
        eq(auditLog.resourceType, "client"),
        eq(clients.firmId, auditLog.firmId),
        eq(clients.id, auditLog.resourceId),
      ),
    )
    .leftJoin(
      tasks,
      and(
        eq(auditLog.resourceType, "task"),
        eq(tasks.firmId, auditLog.firmId),
        eq(tasks.id, auditLog.resourceId),
      ),
    )
    .leftJoin(
      clientRepresentatives,
      and(
        eq(auditLog.resourceType, "client_representative"),
        eq(clientRepresentatives.firmId, auditLog.firmId),
        eq(clientRepresentatives.id, auditLog.resourceId),
      ),
    )
    .where(inArray(auditLog.resourceType, resourceTypes))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return rows;
}

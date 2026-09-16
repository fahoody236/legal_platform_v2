import { and, asc, count, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { cases } from "../schema/cases.js";
import { clients } from "../schema/clients.js";
import { tasks } from "../schema/tasks.js";
import type { TenantTransaction } from "../tenant-context.js";
import type { CaseStatus } from "../schema/cases.js";
import type { ClientType } from "../schema/clients.js";
import type { TaskPriority, TaskStatus } from "../schema/tasks.js";

/**
 * Search across a firm's records.
 *
 * ── Normalisation happens in the database, on both sides ─────────────────────
 *
 * Every comparison below is `normalise_arabic(column) <op> normalise_arabic($q)`.
 * The function is defined in migration 0013 and backs the trigram indexes, so
 * the stored value and the query are folded by the same code — the only
 * arrangement in which "شركه" is guaranteed to find "شركة". Nothing in
 * TypeScript normalises the term; the raw string goes to SQL.
 *
 * ── Ranking ──────────────────────────────────────────────────────────────────
 *
 * A small integer per row, lower first:
 *
 *   0  an identifier equals the query        national ID, registration, case number
 *   1  an identifier starts with the query   "2026/" finds that year's cases
 *   2  a name or title starts with the query
 *   3  a name or title contains the query
 *   4  a long or indirect field contains it  court, description, a case's client
 *
 * Computed as a CASE expression so it is one place, sorted on in SQL, and the
 * same for the count as for the page. Within a tier, newest first — a search
 * box is more often looking for recent work than old.
 *
 * ── What is not scoped here ──────────────────────────────────────────────────
 *
 * Nothing names `firm_id`. Row-level security supplies it on every table these
 * queries touch, so a search can only ever see one firm — and that is enforced
 * before any of this code runs, not by it. Permission per group is the caller's
 * job (the service), because it depends on who is asking, which this layer does
 * not know.
 */

export const SEARCH_MIN_LENGTH = 2;

function norm(value: SQL | string): SQL {
  return sql`normalise_arabic(${value})`;
}

function like(column: SQL, pattern: SQL): SQL {
  return sql`${norm(column)} like ${pattern}`;
}

/** The three shapes of pattern, built once per query. */
function patterns(term: string) {
  // `%` and `_` in the query would otherwise be wildcards. Escaped, so a
  // person searching for "50%" finds "50%".
  const escaped = term.replace(/[\\%_]/g, (char) => `\\${char}`);
  return {
    exact: norm(term),
    prefix: sql`${norm(escaped)} || '%'`,
    contains: sql`'%' || ${norm(escaped)} || '%'`,
  };
}

export interface SearchGroup<T> {
  items: T[];
  total: number;
}

export interface ClientHit {
  id: string;
  clientType: ClientType;
  nameAr: string;
  name: string | null;
  identifier: string | null;
  archivedAt: Date | null;
  rank: number;
}

export async function searchClients(
  tx: TenantTransaction,
  term: string,
  limit: number,
): Promise<SearchGroup<ClientHit>> {
  const p = patterns(term);
  const identifier = sql`coalesce(${clients.nationalId}, ${clients.commercialRegistration})`;
  const nameAr = sql`${clients.nameAr}`;
  const name = sql`coalesce(${clients.name}, '')`;

  const rank = sql<number>`case
    when ${identifier} = ${p.exact} then 0
    when ${identifier} like ${p.prefix} then 1
    when ${like(nameAr, p.prefix)} or ${like(name, p.prefix)} then 2
    when ${like(nameAr, p.contains)} or ${like(name, p.contains)} then 3
    else 4
  end`;

  const matches = sql`(
    ${identifier} like ${p.contains}
    or ${like(nameAr, p.contains)}
    or ${like(name, p.contains)}
  )`;

  const items = await tx
    .select({
      id: clients.id,
      clientType: clients.clientType,
      nameAr: clients.nameAr,
      name: clients.name,
      identifier: sql<string | null>`${identifier}`,
      archivedAt: clients.archivedAt,
      rank: sql<number>`${rank}`.as("rank"),
    })
    .from(clients)
    .where(matches)
    .orderBy(asc(sql`rank`), desc(clients.createdAt))
    .limit(limit);

  const [totals] = await tx.select({ value: count() }).from(clients).where(matches);

  return { items, total: totals?.value ?? 0 };
}

export interface CaseHit {
  id: string;
  caseNumber: string;
  titleAr: string;
  title: string | null;
  status: CaseStatus;
  clientNameAr: string;
  archivedAt: Date | null;
  rank: number;
}

export async function searchCases(
  tx: TenantTransaction,
  term: string,
  limit: number,
): Promise<SearchGroup<CaseHit>> {
  const p = patterns(term);
  const number = sql`${cases.caseNumber}`;
  const titleAr = sql`${cases.titleAr}`;
  const title = sql`coalesce(${cases.title}, '')`;
  const court = sql`coalesce(${cases.court}, '')`;
  const clientName = sql`${clients.nameAr}`;

  const rank = sql<number>`case
    when ${norm(number)} = ${p.exact} then 0
    when ${like(number, p.prefix)} then 1
    when ${like(titleAr, p.prefix)} or ${like(title, p.prefix)} then 2
    when ${like(titleAr, p.contains)} or ${like(title, p.contains)} then 3
    else 4
  end`;

  const matches = sql`(
    ${like(number, p.contains)}
    or ${like(titleAr, p.contains)}
    or ${like(title, p.contains)}
    or ${like(court, p.contains)}
    or ${like(clientName, p.contains)}
  )`;

  const join = and(eq(clients.firmId, cases.firmId), eq(clients.id, cases.clientId));

  const items = await tx
    .select({
      id: cases.id,
      caseNumber: cases.caseNumber,
      titleAr: cases.titleAr,
      title: cases.title,
      status: cases.status,
      clientNameAr: clients.nameAr,
      archivedAt: cases.archivedAt,
      rank: sql<number>`${rank}`.as("rank"),
    })
    .from(cases)
    .innerJoin(clients, join)
    .where(matches)
    .orderBy(asc(sql`rank`), desc(cases.openedAt))
    .limit(limit);

  // The join is needed on the count here, unlike the list queries: the client's
  // name is one of the matched fields, so the predicate cannot be evaluated
  // without it. Inner join on a NOT NULL foreign key, so no row multiplies.
  const [totals] = await tx
    .select({ value: count() })
    .from(cases)
    .innerJoin(clients, join)
    .where(matches);

  return { items, total: totals?.value ?? 0 };
}

export interface TaskHit {
  id: string;
  caseId: string;
  caseNumber: string;
  titleAr: string;
  title: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date | null;
  rank: number;
}

/**
 * Archived tasks are excluded, as they are from the task list: a task list is
 * a list of work, and archived work is not. Cases and clients are records and
 * stay findable when archived — the result says so, and the page they lead to
 * says so again.
 */
export async function searchTasks(
  tx: TenantTransaction,
  term: string,
  limit: number,
): Promise<SearchGroup<TaskHit>> {
  const p = patterns(term);
  const titleAr = sql`${tasks.titleAr}`;
  const title = sql`coalesce(${tasks.title}, '')`;
  const description = sql`coalesce(${tasks.description}, '')`;

  const rank = sql<number>`case
    when ${like(titleAr, p.prefix)} or ${like(title, p.prefix)} then 2
    when ${like(titleAr, p.contains)} or ${like(title, p.contains)} then 3
    else 4
  end`;

  const matches = and(
    isNull(tasks.archivedAt),
    sql`(
      ${like(titleAr, p.contains)}
      or ${like(title, p.contains)}
      or ${like(description, p.contains)}
    )`,
  );

  const join = and(eq(cases.firmId, tasks.firmId), eq(cases.id, tasks.caseId));

  const items = await tx
    .select({
      id: tasks.id,
      caseId: tasks.caseId,
      caseNumber: cases.caseNumber,
      titleAr: tasks.titleAr,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueAt: tasks.dueAt,
      rank: sql<number>`${rank}`.as("rank"),
    })
    .from(tasks)
    .innerJoin(cases, join)
    .where(matches)
    .orderBy(asc(sql`rank`), desc(tasks.createdAt))
    .limit(limit);

  const [totals] = await tx.select({ value: count() }).from(tasks).where(matches);

  return { items, total: totals?.value ?? 0 };
}

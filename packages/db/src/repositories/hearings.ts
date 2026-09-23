import {
  and,
  asc,
  count,
  eq,
  getTableColumns,
  gte,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import { cases } from "../schema/cases.js";
import { hearings } from "../schema/hearings.js";
import { currentFirmId, type TenantTransaction } from "../tenant-context.js";
import type {
  Hearing,
  HearingStatus,
  HearingType,
} from "../schema/hearings.js";

export { HEARING_STATUSES, HEARING_TYPES } from "../schema/hearings.js";
export type {
  Hearing,
  HearingStatus,
  HearingType,
  NewHearing,
} from "../schema/hearings.js";

/**
 * A hearing with the case it sits on, and the court to use when its own is
 * null.
 *
 * `effectiveCourt` is resolved in SQL rather than in the interface: the rule
 * "a hearing without a court is in the case's court" has to be the same for a
 * list, a dashboard and any later export, and a coalesce in one screen is a
 * rule that exists in one screen.
 */
export interface HearingWithCase extends Hearing {
  caseNumber: string;
  caseTitleAr: string;
  caseCourt: string | null;
  effectiveCourt: string | null;
}

const hearingWithCaseColumns = {
  ...getTableColumns(hearings),
  caseNumber: cases.caseNumber,
  caseTitleAr: cases.titleAr,
  caseCourt: cases.court,
  effectiveCourt: sql<
    string | null
  >`coalesce(${hearings.court}, ${cases.court})`.as("effective_court"),
};

export interface ListHearingsFilters {
  caseId?: string | undefined;
  status?: HearingStatus | undefined;
  /** Still to happen: scheduled, and not in the past. */
  upcoming?: boolean | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  includeArchived?: boolean | undefined;
  limit: number;
  offset: number;
}

export interface ListHearingsResult {
  items: HearingWithCase[];
  total: number;
}

function filterConditions(filters: ListHearingsFilters) {
  return [
    filters.caseId ? eq(hearings.caseId, filters.caseId) : undefined,
    filters.status ? eq(hearings.status, filters.status) : undefined,
    // Matches the partial index in 0017 exactly — same status, same archived
    // condition — plus the time bound, so the filter can use it. Written any
    // other way it would be correct and would scan.
    filters.upcoming
      ? and(
          eq(hearings.status, "scheduled"),
          isNull(hearings.archivedAt),
          gte(hearings.scheduledAt, sql`now()`),
        )
      : undefined,
    filters.from ? gte(hearings.scheduledAt, filters.from) : undefined,
    filters.to ? lte(hearings.scheduledAt, filters.to) : undefined,
    filters.includeArchived ? undefined : isNull(hearings.archivedAt),
  ].filter((condition) => condition !== undefined);
}

/**
 * A page of the firm's hearings, soonest first.
 *
 * Ascending by date, unlike tasks and cases: a hearing list is read forwards —
 * what is coming — and the history below it is the tail, not the head. Within
 * a date, by creation, so an adjournment and its successor keep their order.
 */
export async function listHearings(
  tx: TenantTransaction,
  filters: ListHearingsFilters,
): Promise<ListHearingsResult> {
  const conditions = filterConditions(filters);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const items = await tx
    .select(hearingWithCaseColumns)
    .from(hearings)
    .innerJoin(
      cases,
      and(eq(cases.firmId, hearings.firmId), eq(cases.id, hearings.caseId)),
    )
    .where(where)
    .orderBy(asc(hearings.scheduledAt), asc(hearings.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);

  // No join on the count: it cannot change it, and including it would only
  // give a future edit somewhere to introduce a row multiplication.
  const [totals] = await tx
    .select({ value: count() })
    .from(hearings)
    .where(where);

  return { items, total: totals?.value ?? 0 };
}

export async function findHearingById(
  tx: TenantTransaction,
  id: string,
): Promise<HearingWithCase | undefined> {
  const [row] = await tx
    .select(hearingWithCaseColumns)
    .from(hearings)
    .innerJoin(
      cases,
      and(eq(cases.firmId, hearings.firmId), eq(cases.id, hearings.caseId)),
    )
    .where(eq(hearings.id, id))
    .limit(1);

  return row;
}

export interface CreateHearingInput {
  caseId: string;
  scheduledAt: Date;
  court?: string | null;
  circuit?: string | null;
  hearingType: HearingType;
  status?: HearingStatus;
  notes?: string | null;
  createdByUserId: string;
}

/**
 * `firm_id` comes from the tenant context, never the caller.
 *
 * `status` defaults to `scheduled` and the API does not offer anything else on
 * create: a hearing recorded as already held is a record nobody made at the
 * time, and the honest way to enter one is to create it and then mark it held,
 * so the trail says who did and when.
 */
export async function createHearing(
  tx: TenantTransaction,
  input: CreateHearingInput,
): Promise<Hearing> {
  const firmId = await currentFirmId(tx);

  const [row] = await tx
    .insert(hearings)
    .values({
      firmId,
      caseId: input.caseId,
      scheduledAt: input.scheduledAt,
      court: input.court ?? null,
      circuit: input.circuit ?? null,
      hearingType: input.hearingType,
      status: input.status ?? "scheduled",
      notes: input.notes ?? null,
      createdByUserId: input.createdByUserId,
    })
    .returning();

  if (!row) {
    throw new Error("createHearing: insert returned no row");
  }

  return row;
}

/**
 * The editable surface of a hearing.
 *
 * `status` is absent: it moves through its own operations, so that "the court
 * sat and adjourned" is an event in the trail rather than a field that
 * changed. `caseId` is absent because moving a hearing to another matter is a
 * re-filing, not an edit.
 */
export interface UpdateHearingInput {
  scheduledAt?: Date | undefined;
  court?: string | null | undefined;
  circuit?: string | null | undefined;
  hearingType?: HearingType | undefined;
  notes?: string | null | undefined;
  archivedAt?: Date | null | undefined;
}

export async function updateHearing(
  tx: TenantTransaction,
  id: string,
  input: UpdateHearingInput,
): Promise<Hearing | undefined> {
  const values: Record<string, unknown> = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );

  if (Object.keys(values).length === 0) {
    const [row] = await tx
      .select()
      .from(hearings)
      .where(eq(hearings.id, id))
      .limit(1);
    return row;
  }

  const [row] = await tx
    .update(hearings)
    .set(values)
    .where(eq(hearings.id, id))
    .returning();

  return row;
}

/**
 * Moves a hearing to a new status, optionally recording what happened.
 *
 * `notes` is `undefined` to leave them alone and `null` to clear them, so
 * "mark this held without a note" and "erase the note" stay distinguishable.
 */
export async function setHearingStatus(
  tx: TenantTransaction,
  id: string,
  status: HearingStatus,
  notes?: string | null | undefined,
): Promise<Hearing | undefined> {
  const [row] = await tx
    .update(hearings)
    .set({ status, ...(notes === undefined ? {} : { notes }) })
    .where(eq(hearings.id, id))
    .returning();

  return row;
}

export interface UpcomingHearing {
  id: string;
  caseId: string;
  caseNumber: string;
  caseTitleAr: string;
  scheduledAt: Date;
  hearingType: HearingType;
  court: string | null;
  circuit: string | null;
  assignedLawyerName: string | null;
}

/**
 * The firm's next hearings, across every matter, for the dashboard.
 *
 * Every hearing rather than one per case, which is the opposite of
 * `listUpcomingDeadlines`: two hearings on one matter in the same fortnight
 * are two days someone has to be in court, and collapsing them would hide the
 * second. The lawyer comes from the case, since a hearing has no attendee of
 * its own — that is the column 0017 deliberately does not have.
 */
export async function listUpcomingHearings(
  tx: TenantTransaction,
  days: number,
  limit: number,
): Promise<UpcomingHearing[]> {
  const rows = await tx.execute<{
    id: string;
    case_id: string;
    case_number: string;
    case_title_ar: string;
    scheduled_at: string;
    hearing_type: HearingType;
    court: string | null;
    circuit: string | null;
    assigned_lawyer_name: string | null;
  }>(sql`
    select
      h.id                as id,
      h.case_id           as case_id,
      c.case_number       as case_number,
      c.title_ar          as case_title_ar,
      h.scheduled_at      as scheduled_at,
      h.hearing_type      as hearing_type,
      coalesce(h.court, c.court) as court,
      h.circuit           as circuit,
      coalesce(u.full_name_ar, u.full_name) as assigned_lawyer_name
    from hearings h
    inner join cases c
      on c.firm_id = h.firm_id and c.id = h.case_id
    left join users u
      on u.firm_id = c.firm_id and u.id = c.assigned_lawyer_id
    where h.status = 'scheduled'
      and h.archived_at is null
      and c.archived_at is null
      and h.scheduled_at >= now()
      and h.scheduled_at < now() + make_interval(days => ${days})
    order by h.scheduled_at asc
    limit ${limit}
  `);

  return rows.rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    caseNumber: row.case_number,
    caseTitleAr: row.case_title_ar,
    scheduledAt: new Date(row.scheduled_at),
    hearingType: row.hearing_type,
    court: row.court,
    circuit: row.circuit,
    assignedLawyerName: row.assigned_lawyer_name,
  }));
}

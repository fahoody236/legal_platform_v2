import { and, count, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { cases } from "../schema/cases.js";
import { clients } from "../schema/clients.js";
import { users } from "../schema/users.js";
import { currentFirmId, type TenantTransaction } from "../tenant-context.js";

/**
 * The cases repository.
 *
 * Every function takes the transaction from `withTenant` and nothing else, so
 * the tenant policies are in force for all of it. Note that no query below
 * mentions `firm_id`: the policy supplies it, and a filter someone forgets to
 * write returns zero rows rather than another firm's matters.
 *
 * That is also what makes "does not exist" and "belongs to another firm"
 * indistinguishable here rather than by convention at the HTTP layer. A lookup
 * for a case in another firm is not a case this code declines to return — it is
 * a row this connection cannot see, so there is no branch that could
 * accidentally treat the two differently.
 */

export { CASE_STATUSES } from "../schema/cases.js";
export type { Case, CaseStatus, NewCase } from "../schema/cases.js";

import type { Case, CaseStatus } from "../schema/cases.js";

export interface ListCasesFilters {
  status?: CaseStatus | undefined;
  assignedLawyerId?: string | undefined;
  clientId?: string | undefined;
  limit: number;
  offset: number;
}

/**
 * A case with the two references resolved to names.
 *
 * The ids stay. A screen needs both — the name to read and the id to link to or
 * filter by — and dropping the id would force a second lookup to do anything
 * with the row.
 *
 * Note what returning these names means: `cases.view` now discloses client names
 * and lawyer names to anyone who can see the case. That is a deliberate widening
 * of what one permission reveals, accepted on the grounds that a case list
 * without the client's name is not usable, and the row already carries the
 * matter's title, which says more.
 */
export interface CaseWithNames extends Case {
  /** Always present: `client_id` is NOT NULL and foreign-keyed. */
  clientNameAr: string;
  /** Null when the case is unassigned. Arabic name, falling back to Latin. */
  assignedLawyerName: string | null;
}

export interface ListCasesResult {
  items: CaseWithNames[];
  /** Matching rows in the caller's firm, before limit and offset. */
  total: number;
}

/**
 * The two joins that resolve the references.
 *
 * Both carry `firm_id` in the join condition even though row-level security
 * already confines all three tables to one firm. It costs nothing, it matches
 * the composite keys the tables are actually built on, and it means a reader can
 * see that no other firm's name can enter this result without first having to
 * know the policy text.
 *
 * `clients` is an inner join and `users` a left join, which is the difference
 * between a column that is NOT NULL and one that is: every case has a client,
 * while an unassigned case is an ordinary state.
 *
 * The lawyer's name prefers Arabic and falls back to Latin. `full_name_ar` is
 * nullable on `users` — unlike on clients and cases, where migration 0011 made
 * Arabic the required name — so without the fallback an unassigned-looking blank
 * would appear for a real, named person.
 */
const caseWithNamesColumns = {
  ...getTableColumns(cases),
  clientNameAr: clients.nameAr,
  assignedLawyerName: sql<
    string | null
  >`coalesce(${users.fullNameAr}, ${users.fullName})`.as(
    "assigned_lawyer_name",
  ),
};

/**
 * A page of the firm's cases, newest first.
 *
 * `total` is counted after the tenant policy and the filters, never over the
 * table — an aggregate is a disclosure, and a count that included other firms'
 * matters would leak the shape of their practice without returning a single row
 * (docs/threat-model.md, rival firm's employee).
 *
 * Ordered by `opened_at` then `id`. The second key is not decoration: without a
 * tiebreak, two cases opened in the same transaction have no defined order, and
 * an offset-paginated list can then show one of them twice and the other never.
 *
 * Archived cases are included. That matches `listUsers` and is deliberate at
 * this layer — the repository does not decide what a screen shows — but it does
 * mean a working-list endpoint needs its own filter. There is no such filter
 * yet.
 */
export async function listCases(
  tx: TenantTransaction,
  filters: ListCasesFilters,
): Promise<ListCasesResult> {
  const conditions = [
    filters.status ? eq(cases.status, filters.status) : undefined,
    filters.assignedLawyerId
      ? eq(cases.assignedLawyerId, filters.assignedLawyerId)
      : undefined,
    filters.clientId ? eq(cases.clientId, filters.clientId) : undefined,
  ].filter((condition) => condition !== undefined);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const items = await tx
    .select(caseWithNamesColumns)
    .from(cases)
    .innerJoin(
      clients,
      and(eq(clients.firmId, cases.firmId), eq(clients.id, cases.clientId)),
    )
    .leftJoin(
      users,
      and(
        eq(users.firmId, cases.firmId),
        eq(users.id, cases.assignedLawyerId),
      ),
    )
    .where(where)
    .orderBy(desc(cases.openedAt), desc(cases.id))
    .limit(filters.limit)
    .offset(filters.offset);

  // No joins on the count. They cannot change it — the client join is on a
  // NOT NULL foreign key and the lawyer join is outer — so including them would
  // only make the query more expensive and give a future edit somewhere to
  // introduce a row multiplication that silently inflates the total.
  const [totals] = await tx
    .select({ value: count() })
    .from(cases)
    .where(where);

  return { items, total: totals?.value ?? 0 };
}

/**
 * Returns undefined both for an id that does not exist and for one belonging to
 * another firm. The policy makes those the same outcome, which is what lets the
 * endpoint answer 404 to both without having to remember to.
 */
export async function findCaseById(
  tx: TenantTransaction,
  id: string,
): Promise<CaseWithNames | undefined> {
  const [row] = await tx
    .select(caseWithNamesColumns)
    .from(cases)
    .innerJoin(
      clients,
      and(eq(clients.firmId, cases.firmId), eq(clients.id, cases.clientId)),
    )
    .leftJoin(
      users,
      and(
        eq(users.firmId, cases.firmId),
        eq(users.id, cases.assignedLawyerId),
      ),
    )
    .where(eq(cases.id, id))
    .limit(1);

  return row;
}

export interface CreateCaseInput {
  clientId: string;
  caseNumber: string;
  titleAr: string;
  title?: string | null;
  caseType: string;
  court?: string | null;
  status: CaseStatus;
  assignedLawyerId?: string | null;
  openedAt?: Date | undefined;
}

/**
 * `firm_id` comes from the transaction's tenant context, never from the caller
 * — same as `createUser`, and for the same reason: the parameter that would let
 * a case be filed into another firm does not exist. The policy's WITH CHECK
 * would reject such a write anyway; this makes it unexpressible a layer earlier.
 *
 * The client and the assigned lawyer are checked by the composite foreign keys,
 * which carry `firm_id`. A caller naming another firm's client gets a foreign
 * key violation, indistinguishable from naming a client that does not exist —
 * the reference is unrepresentable rather than merely rejected.
 */
export async function createCase(
  tx: TenantTransaction,
  input: CreateCaseInput,
): Promise<Case> {
  const firmId = await currentFirmId(tx);

  const [row] = await tx
    .insert(cases)
    .values({
      firmId,
      clientId: input.clientId,
      caseNumber: input.caseNumber,
      titleAr: input.titleAr,
      title: input.title ?? null,
      caseType: input.caseType,
      court: input.court ?? null,
      status: input.status,
      assignedLawyerId: input.assignedLawyerId ?? null,
      // Omitted rather than nulled when absent, so the column default applies.
      ...(input.openedAt ? { openedAt: input.openedAt } : {}),
    })
    .returning();

  if (!row) {
    throw new Error("createCase: insert returned no row");
  }

  return row;
}

/**
 * The editable surface of a case.
 *
 * `assignedLawyerId` is deliberately absent, and its absence is a permission
 * boundary rather than an oversight. Assignment is `cases.assign`, held
 * separately from `cases.edit` because it allocates work and reveals who is on
 * what (docs/decisions/0004-permissions.md). If this interface carried the
 * column, every holder of `cases.edit` would silently hold `cases.assign` too,
 * and the split would exist only in the catalogue.
 *
 * `clientId` is absent for a different reason: moving a matter to another client
 * is not an edit to a field, it is a re-filing, and it should be an operation
 * with its own record rather than a PATCH nobody notices.
 */
export interface UpdateCaseInput {
  caseNumber?: string | undefined;
  titleAr?: string | undefined;
  title?: string | null | undefined;
  caseType?: string | undefined;
  court?: string | null | undefined;
  status?: CaseStatus | undefined;
  closedAt?: Date | null | undefined;
}

/**
 * Applies the given fields and returns the updated row, or undefined if the
 * case is not visible in this tenant context — unknown id and another firm's id
 * alike, since the policy makes them the same zero-row result.
 *
 * Keys absent from `input` are left untouched, so a PATCH that names one field
 * cannot blank the rest.
 */
export async function updateCase(
  tx: TenantTransaction,
  id: string,
  input: UpdateCaseInput,
): Promise<Case | undefined> {
  const values = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );

  if (Object.keys(values).length === 0) {
    return findCaseById(tx, id);
  }

  const [row] = await tx
    .update(cases)
    .set(values)
    .where(eq(cases.id, id))
    .returning();

  return row;
}

/**
 * Sets or clears the responsible lawyer.
 *
 * `null` unassigns, which is a real state rather than a gap — a matter waiting
 * to be allocated is one a firm needs to be able to list.
 *
 * The lawyer is validated by the composite foreign key: another firm's user id
 * cannot be written here, and fails identically to a user id that does not
 * exist.
 */
export async function assignCase(
  tx: TenantTransaction,
  id: string,
  lawyerId: string | null,
): Promise<Case | undefined> {
  const [row] = await tx
    .update(cases)
    .set({ assignedLawyerId: lawyerId })
    .where(eq(cases.id, id))
    .returning();

  return row;
}

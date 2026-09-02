import { CASE_STATUSES } from "@legal/db";
import { z } from "zod";

/**
 * Every input to the cases API, parsed at the boundary.
 *
 * The length caps are the same idea as the ones on sign-in: a text column with
 * no ceiling is a way to make the server store and index arbitrary work per
 * request. The numbers are far past any real case title and well short of a
 * problem.
 *
 * Note what validation does *not* do here. It does not check that the client or
 * the lawyer belongs to the caller's firm — that is the composite foreign keys'
 * job, and doing it here as well would be a second, weaker copy of a rule the
 * database already enforces absolutely.
 */

const uuid = z.string().uuid();
const caseStatus = z.enum(CASE_STATUSES);

/**
 * `limit` is capped. An uncapped page size is an invitation to pull a firm's
 * entire matter list in one request, which is the shape of an exfiltration
 * rather than of a screen.
 */
export const listCasesQuerySchema = z.object({
  status: caseStatus.optional(),
  assignedLawyerId: uuid.optional(),
  clientId: uuid.optional(),
  // Query strings arrive as text, so these coerce before they are bounded.
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListCasesQuery = z.infer<typeof listCasesQuerySchema>;

export const caseIdSchema = uuid;

export const createCaseSchema = z.object({
  clientId: uuid,
  caseNumber: z.string().trim().min(1).max(64),
  /** Required, like the column. Arabic is the title a firm actually reads. */
  titleAr: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(500).nullish(),
  caseType: z.string().trim().min(1).max(100),
  court: z.string().trim().min(1).max(200).nullish(),
  /**
   * Defaulted rather than required. A new matter is open; making the caller say
   * so invites a client that sends `closed` by accident and a case that never
   * appears on a working list.
   */
  status: caseStatus.default("open"),
  assignedLawyerId: uuid.nullish(),
  openedAt: z.coerce.date().optional(),
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;

/**
 * Every field optional, and at least one required.
 *
 * The refinement matters: without it, `PATCH` with an empty body is a request
 * that changes nothing but still writes an audit entry saying someone edited the
 * case. An append-only trail cannot be tidied afterwards, so the empty edit is
 * refused rather than recorded.
 *
 * `titleAr` can be changed but not cleared — the column is NOT NULL, and the
 * schema says so here rather than letting the constraint say it in a 500.
 *
 * `assignedLawyerId` is absent on purpose. It belongs to `cases.assign`; see
 * UpdateCaseInput in the repository for why putting it here would collapse two
 * permissions into one.
 */
export const updateCaseSchema = z
  .object({
    caseNumber: z.string().trim().min(1).max(64).optional(),
    titleAr: z.string().trim().min(1).max(500).optional(),
    title: z.string().trim().min(1).max(500).nullish(),
    caseType: z.string().trim().min(1).max(100).optional(),
    court: z.string().trim().min(1).max(200).nullish(),
    status: caseStatus.optional(),
    closedAt: z.coerce.date().nullish(),
  })
  .refine((value) => Object.keys(value).length > 0);

export type UpdateCaseInput = z.infer<typeof updateCaseSchema>;

/**
 * Nullable but not optional. Unassigning is a deliberate act, so it takes an
 * explicit `null` — an omitted field would make "clear the assignment" and
 * "I forgot to send one" the same request.
 */
export const assignCaseSchema = z.object({
  assignedLawyerId: uuid.nullable(),
});

export type AssignCaseInput = z.infer<typeof assignCaseSchema>;

import { HEARING_STATUSES, HEARING_TYPES, type HearingStatus } from "@legal/db";
import { z } from "zod";

const uuid = z.string().uuid();
const hearingType = z.enum(HEARING_TYPES);
const status = z.enum(HEARING_STATUSES);

const court = z.string().trim().min(1).max(200).nullish();
const circuit = z.string().trim().min(1).max(200).nullish();
const notes = z.string().trim().min(1).max(5000).nullish();

/**
 * `adjourned` is not an accepted value on the status route.
 *
 * Adjourning is two rows — this hearing closes, a successor opens — and a
 * single status field cannot express a pair any more than `done` could
 * express a task's completion timestamp (0012). Sending it here is a 400
 * naming the route to use, rather than a status change that quietly loses the
 * half of the event that matters.
 */
type SettableStatus = Exclude<HearingStatus, "adjourned">;

// Derived from HEARING_STATUSES rather than written out, so a status added by
// a later migration is settable by default and only `adjourned` is special.
// The cast restores the literal tuple z.enum needs; filter widens it.
const SETTABLE_STATUSES = HEARING_STATUSES.filter(
  (value): value is SettableStatus => value !== "adjourned",
) as [SettableStatus, ...SettableStatus[]];

export const listHearingsQuerySchema = z.object({
  caseId: uuid.optional(),
  status: status.optional(),
  // Only these two spellings count, so `?upcoming=maybe` is a 400 rather than
  // a silent false that would quietly widen the list to every hearing ever.
  upcoming: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  includeArchived: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListHearingsQuery = z.infer<typeof listHearingsQuerySchema>;

export const hearingIdSchema = uuid;

/**
 * No `status` and no `notes`.
 *
 * A hearing is created scheduled; one recorded as already held is a record
 * nobody made at the time, and the honest way to enter a past hearing is to
 * create it and then mark it held, so the trail says who did that and when.
 * Notes follow from the same fact — there is nothing to record about a
 * hearing that has not happened, and a box offered at scheduling time fills
 * with preparation reminders, which are what tasks are for.
 */
export const createHearingSchema = z
  .object({
    caseId: uuid,
    scheduledAt: z.coerce.date(),
    court,
    circuit,
    hearingType: hearingType.default("pleading"),
  })
  .strict();

export type CreateHearingInput = z.infer<typeof createHearingSchema>;

/**
 * Strict, and `status` is not a key: status moves through its own routes so
 * that "the court sat" is an event in the audit trail rather than a field
 * that changed. `notes` is here, because correcting what was recorded about a
 * hearing that has happened is an edit like any other.
 */
export const updateHearingSchema = z
  .object({
    scheduledAt: z.coerce.date().optional(),
    court,
    circuit,
    hearingType: hearingType.optional(),
    notes,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export type UpdateHearingInput = z.infer<typeof updateHearingSchema>;

/**
 * Marking a hearing held, cancelled, or back to scheduled.
 *
 * `notes` rides along because this is the moment the information exists: the
 * hearing has just happened, and the person recording that is the person who
 * knows what it produced.
 */
export const setHearingStatusSchema = z
  .object({
    status: z.enum(SETTABLE_STATUSES),
    notes,
  })
  .strict();

export type SetHearingStatusInput = z.infer<typeof setHearingStatusSchema>;

/**
 * Adjournment: this hearing closes and, where the court gave a date, a
 * successor opens.
 *
 * `scheduledAt` is optional on purpose. Courts adjourn without setting a date,
 * and a request that refused to record that would push people towards
 * inventing one. Omitting it records the adjournment alone; the next hearing
 * is created when the date is known.
 *
 * The successor's court, circuit and type default to the closing hearing's,
 * since an adjourned matter usually returns to the same bench for the same
 * purpose.
 */
export const adjournHearingSchema = z
  .object({
    /** What happened — why it was adjourned. */
    notes,
    scheduledAt: z.coerce.date().optional(),
    court,
    circuit,
    hearingType: hearingType.optional(),
  })
  .strict();

export type AdjournHearingInput = z.infer<typeof adjournHearingSchema>;

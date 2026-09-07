import { TASK_PRIORITIES, TASK_STATUSES, type TaskStatus } from "@legal/db";
import { z } from "zod";

const uuid = z.string().uuid();
const status = z.enum(TASK_STATUSES);
const priority = z.enum(TASK_PRIORITIES);

/**
 * `done` is not an accepted value on create or update.
 *
 * Completing a task writes `status` and `completed_at` together — they are
 * bound by a CHECK constraint (migration 0012) — and a field on an edit form
 * cannot express a pair. Sending it here is a 400 rather than a silently
 * rejected constraint violation, and the action to use instead is
 * `POST /tasks/:id/complete`.
 */
type EditableStatus = Exclude<TaskStatus, "done">;

// Derived from TASK_STATUSES rather than written out, so a status added by a
// future migration is editable by default and only `done` is special. The cast
// restores the literal tuple `z.enum` needs; `filter` widens it to an array.
const EDITABLE_STATUSES = TASK_STATUSES.filter(
  (value): value is EditableStatus => value !== "done",
) as [EditableStatus, ...EditableStatus[]];

const editableStatus = z.enum(EDITABLE_STATUSES);

export const listTasksQuerySchema = z.object({
  caseId: uuid.optional(),
  assignedToUserId: uuid.optional(),
  status: status.optional(),
  priority: priority.optional(),
  // Only these two spellings count, so `?overdue=maybe` is a 400 rather than a
  // silent false that would quietly show every task as on time.
  overdue: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  includeArchived: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const taskIdSchema = uuid;

export const createTaskSchema = z
  .object({
    caseId: uuid,
    titleAr: z.string().trim().min(1).max(500),
    title: z.string().trim().min(1).max(500).nullish(),
    description: z.string().trim().min(1).max(5000).nullish(),
    assignedToUserId: uuid.nullish(),
    status: editableStatus.default("open"),
    priority: priority.default("normal"),
    dueAt: z.coerce.date().nullish(),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/**
 * Strict, and `assignedToUserId` is not a key — assignment is `tasks.assign`,
 * a separate permission, so accepting it here would let every holder of
 * `tasks.edit` assign work too. Sending it is a 400 rather than a silently
 * ignored field.
 */
export const updateTaskSchema = z
  .object({
    titleAr: z.string().trim().min(1).max(500).optional(),
    title: z.string().trim().min(1).max(500).nullish(),
    description: z.string().trim().min(1).max(5000).nullish(),
    status: editableStatus.optional(),
    priority: priority.optional(),
    dueAt: z.coerce.date().nullish(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/**
 * Nullable but not optional. Unassigning is a deliberate act, so it takes an
 * explicit `null` — an omitted field would make "clear the assignment" and "I
 * forgot to send one" the same request.
 */
export const assignTaskSchema = z
  .object({ assignedToUserId: uuid.nullable() })
  .strict();

export type AssignTaskInput = z.infer<typeof assignTaskSchema>;

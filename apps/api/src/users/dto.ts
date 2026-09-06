import { z } from "zod";

/**
 * `includeDisabled` defaults to false, which is the opposite of the
 * repository's default, and the difference is the point.
 *
 * The repository serves historical reads, where a colleague who has left must
 * still appear. This endpoint exists mainly to fill pickers — "who should do
 * this work" — and the safe answer there is only people who can still do it.
 * A caller that genuinely wants the full directory has to say so.
 */
export const listUsersQuerySchema = z.object({
  // Query strings arrive as text. Only these two spellings count, so
  // `?includeDisabled=maybe` is a 400 rather than a silent false.
  includeDisabled: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional()
    .default("false"),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

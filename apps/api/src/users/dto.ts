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

export const userIdSchema = z.string().uuid();

const email = z.string().trim().min(3).max(320).email();
const fullName = z.string().trim().min(1).max(200);
/**
 * Arabic-first: required here even though the column is nullable. The column
 * predates the decision (see AuthenticatedUser.fullNameAr); new accounts are
 * not allowed to inherit the gap.
 */
const fullNameAr = z.string().trim().min(1).max(200);

/**
 * No `roleIds`, and the omission is deliberate. Creating a person is
 * `users.manage`; deciding what they may do is `roles.manage`, and a route
 * taking both under the first would let a `users.manage` holder create an
 * account carrying the administrator role — and, since they also receive the
 * invitation link, become it. The interface offers roles on the same form by
 * calling `PATCH /users/:id/roles` after this succeeds.
 */
export const createUserSchema = z
  .object({
    email,
    fullNameAr,
    fullName,
  })
  .strict();

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    fullNameAr: fullNameAr.optional(),
    fullName: fullName.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/**
 * The token is base64url of 32 bytes — 43 characters, no padding. Anything
 * else is refused before a hash is computed, though a wrong-length token would
 * simply find nothing.
 */
const invitationToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const lookupInvitationSchema = z
  .object({ token: invitationToken })
  .strict();

export type LookupInvitationInput = z.infer<typeof lookupInvitationSchema>;

/**
 * The same floor as the set-password script. Capped for the same reason as
 * sign-in: the value goes to Argon2, so its length is server work.
 */
export const MIN_PASSWORD_LENGTH = 12;

export const acceptInvitationSchema = z
  .object({
    token: invitationToken,
    password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  })
  .strict();

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

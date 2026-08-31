import { z } from "zod";

/**
 * Bounded before anything expensive happens.
 *
 * The length caps are not cosmetic: the password goes to Argon2, which is
 * deliberately slow and memory-hard, so an unbounded field is a way to make the
 * server do arbitrary work per request. 200 characters is far past any real
 * passphrase and well short of a problem.
 *
 * Email is checked for shape only, and never rejected in a way that reveals
 * whether it belongs to anyone.
 */
export const loginSchema = z.object({
  email: z.string().trim().min(3).max(320).email(),
  password: z.string().min(1).max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;

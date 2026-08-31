import { eq, sql } from "drizzle-orm";
import { credentials } from "../schema/credentials.js";
import { users } from "../schema/users.js";
import { currentFirmId, type TenantTransaction } from "../tenant-context.js";

export interface CredentialRecord {
  credentialId: string;
  userId: string;
  email: string;
  fullName: string;
  passwordHash: string;
  failedAttempts: number;
  lockedUntil: Date | null;
  userDisabledAt: Date | null;
}

/**
 * Looks up a user and their credential by email, case-insensitively.
 *
 * The predicate is written as `lower(email) = lower($1)` to match the
 * expression in the `users_firm_id_lower_email_key` index exactly. A query
 * written any other way — `email ilike $1`, or `lower(email) = $1` with the
 * argument lowered in TypeScript — would still be correct, but the first would
 * not use the index and the second would disagree with it about what counts as
 * a duplicate. Sign-in is the hot path for credential stuffing, so an unindexed
 * scan here is also a denial-of-service surface.
 *
 * Returns the password hash, so this is one of the few reads that must never be
 * logged or serialised. The tenant policy scopes it to the caller's firm; the
 * same address at another firm is a different user and is not visible here.
 */
export async function findCredentialByEmail(
  tx: TenantTransaction,
  email: string,
): Promise<CredentialRecord | undefined> {
  const [row] = await tx
    .select({
      credentialId: credentials.id,
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      passwordHash: credentials.passwordHash,
      failedAttempts: credentials.failedAttempts,
      lockedUntil: credentials.lockedUntil,
      userDisabledAt: users.disabledAt,
    })
    .from(users)
    .innerJoin(credentials, eq(credentials.userId, users.id))
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);

  return row;
}

/**
 * Increments the failure count and locks the credential once it reaches
 * `maxAttempts`.
 *
 * Both happen in one statement so the counter cannot be lost to a race: a
 * read-modify-write would let concurrent guesses each read 4 and each write 5,
 * which is how a lockout threshold quietly becomes a suggestion.
 */
export async function recordFailedAttempt(
  tx: TenantTransaction,
  credentialId: string,
  options: { maxAttempts: number; lockMinutes: number },
): Promise<void> {
  await tx
    .update(credentials)
    .set({
      failedAttempts: sql`${credentials.failedAttempts} + 1`,
      lockedUntil: sql`case
        when ${credentials.failedAttempts} + 1 >= ${options.maxAttempts}
        then now() + make_interval(mins => ${options.lockMinutes})
        else ${credentials.lockedUntil}
      end`,
    })
    .where(eq(credentials.id, credentialId));
}

/** Called on a successful sign-in, clearing both the count and any lock. */
export async function clearFailedAttempts(
  tx: TenantTransaction,
  credentialId: string,
): Promise<void> {
  await tx
    .update(credentials)
    .set({ failedAttempts: 0, lockedUntil: null })
    .where(eq(credentials.id, credentialId));
}

/**
 * Sets a user's password, creating the credential if there is none. The caller
 * hashes — this layer never sees a plaintext password, and `passwordHash` is
 * expected to be an encoded Argon2id digest.
 *
 * Setting a password clears the failure count and any lock. That is the
 * intended behaviour rather than a convenience: an administrator resetting a
 * password for a colleague who has locked themselves out should not have to
 * separately remember to unlock them, and a new password makes the old failed
 * guesses meaningless anyway.
 *
 * One statement, so a concurrent sign-in cannot interleave between a read and a
 * write and resurrect a stale failure count.
 */
export async function upsertCredential(
  tx: TenantTransaction,
  input: { userId: string; passwordHash: string },
): Promise<void> {
  const firmId = await currentFirmId(tx);

  await tx
    .insert(credentials)
    .values({
      firmId,
      userId: input.userId,
      passwordHash: input.passwordHash,
    })
    .onConflictDoUpdate({
      target: credentials.userId,
      set: {
        passwordHash: input.passwordHash,
        passwordUpdatedAt: sql`now()`,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
}

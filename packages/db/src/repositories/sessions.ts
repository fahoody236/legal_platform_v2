import { and, eq, isNull, sql } from "drizzle-orm";
import { sessions } from "../schema/sessions.js";
import { users } from "../schema/users.js";
import { currentFirmId, type TenantTransaction } from "../tenant-context.js";

export interface ActiveSession {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  fullNameAr: string | null;
}

/**
 * `tokenHash` is the SHA-256 of the bearer token. The token itself never
 * reaches this layer, so there is no path by which it could be persisted.
 */
export async function createSession(
  tx: TenantTransaction,
  input: { userId: string; tokenHash: string; expiresAt: Date },
): Promise<string> {
  const firmId = await currentFirmId(tx);

  const [row] = await tx
    .insert(sessions)
    .values({
      firmId,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    })
    .returning({ id: sessions.id });

  if (!row) {
    throw new Error("createSession: insert returned no row");
  }

  return row.id;
}

/**
 * Resolves a token hash to the user it authenticates, or undefined.
 *
 * Four conditions, all enforced in the query rather than by the caller:
 * the hash matches, the session is not revoked, it has not expired, and the
 * user is not disabled. The last one is why disabling someone ends their access
 * on the next request instead of at the next token expiry — the session row is
 * still there, and is simply no longer resolvable.
 *
 * The tenant policy adds a fifth condition for free. A token issued by firm A
 * and presented on firm B's subdomain resolves to nothing, because the lookup
 * runs in firm B's context and the row belongs to firm A.
 */
export async function findActiveSessionByTokenHash(
  tx: TenantTransaction,
  tokenHash: string,
): Promise<ActiveSession | undefined> {
  const [row] = await tx
    .select({
      sessionId: sessions.id,
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      fullNameAr: users.fullNameAr,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        sql`${sessions.expiresAt} > now()`,
        isNull(users.disabledAt),
      ),
    )
    .limit(1);

  return row;
}

/**
 * Ends a session. An UPDATE, never a DELETE: the row records that someone was
 * signed in between two times, which is exactly the kind of history the audit
 * trail depends on. Revoking twice is harmless and leaves the first timestamp
 * intact.
 */
export async function revokeSession(
  tx: TenantTransaction,
  sessionId: string,
): Promise<void> {
  await tx
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/** Records activity, for idle-timeout policy and for a user's session list. */
export async function touchSession(
  tx: TenantTransaction,
  sessionId: string,
): Promise<void> {
  await tx
    .update(sessions)
    .set({ lastSeenAt: sql`now()` })
    .where(eq(sessions.id, sessionId));
}

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { invitations, type Invitation } from "../schema/invitations.js";
import { users } from "../schema/users.js";
import { currentFirmId, type TenantTransaction } from "../tenant-context.js";

export type { Invitation } from "../schema/invitations.js";

/**
 * Issues an invitation. The caller hashes the token: like the credentials
 * repository, this layer never sees the value it is protecting.
 */
export async function createInvitation(
  tx: TenantTransaction,
  input: {
    userId: string;
    invitedByUserId: string;
    tokenHash: string;
    expiresAt: Date;
  },
): Promise<Invitation> {
  const firmId = await currentFirmId(tx);

  const [row] = await tx
    .insert(invitations)
    .values({ firmId, ...input })
    .returning();

  if (!row) {
    throw new Error("createInvitation: insert returned no row");
  }

  return row;
}

/**
 * Marks every still-open invitation for a user as revoked. Called before a
 * resend, so at most one link can set a given person's password, and when a
 * user is disabled, so a link in an inbox cannot outlive the account.
 * Returns how many were revoked — for the audit entry.
 */
export async function revokePendingInvitations(
  tx: TenantTransaction,
  userId: string,
): Promise<number> {
  const rows = await tx
    .update(invitations)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(invitations.userId, userId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .returning({ id: invitations.id });

  return rows.length;
}

export interface OpenInvitation {
  invitationId: string;
  userId: string;
  email: string;
  fullName: string;
  fullNameAr: string | null;
  expiresAt: Date;
}

/**
 * The invitation a presented token refers to, if it can still be accepted:
 * not accepted, not revoked, not expired, and for a user who has not been
 * disabled since. All four failures look the same to the caller, which is
 * right — a person holding a dead link needs a new one whatever killed it.
 *
 * Scoped by the tenant policy like every read here, so a token issued at one
 * firm finds nothing at another.
 */
export async function findOpenInvitationByTokenHash(
  tx: TenantTransaction,
  tokenHash: string,
): Promise<OpenInvitation | undefined> {
  const [row] = await tx
    .select({
      invitationId: invitations.id,
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      fullNameAr: users.fullNameAr,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .innerJoin(
      users,
      and(
        eq(users.firmId, invitations.firmId),
        eq(users.id, invitations.userId),
      ),
    )
    .where(
      and(
        eq(invitations.tokenHash, tokenHash),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, sql`now()`),
        isNull(users.disabledAt),
      ),
    )
    .limit(1);

  return row;
}

/** Closes an invitation as used. Idempotent; the first timestamp stands. */
export async function acceptInvitation(
  tx: TenantTransaction,
  invitationId: string,
): Promise<void> {
  await tx
    .update(invitations)
    .set({ acceptedAt: sql`now()` })
    .where(
      and(eq(invitations.id, invitationId), isNull(invitations.acceptedAt)),
    );
}

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export interface LatestInvitation {
  userId: string;
  status: InvitationStatus;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * The most recent invitation for each user who has one, with its state, in
 * one query. The users screen joins this against the directory to say who
 * has not yet chosen a password and whether their link is still good.
 *
 * DISTINCT ON with the index's own ordering, so it is a single ordered scan.
 */
export async function listLatestInvitations(
  tx: TenantTransaction,
): Promise<LatestInvitation[]> {
  const rows = await tx
    .selectDistinctOn([invitations.userId], {
      userId: invitations.userId,
      createdAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
    })
    .from(invitations)
    .orderBy(invitations.userId, desc(invitations.createdAt));

  const now = Date.now();

  return rows.map((row) => ({
    userId: row.userId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    status: row.acceptedAt
      ? "accepted"
      : row.revokedAt
        ? "revoked"
        : row.expiresAt.getTime() <= now
          ? "expired"
          : "pending",
  }));
}

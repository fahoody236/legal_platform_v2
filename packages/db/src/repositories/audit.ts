import { desc } from "drizzle-orm";
import { auditLog, type AuditLogEntry } from "../schema/audit_log.js";
import { currentFirmId, type TenantTransaction } from "../tenant-context.js";

export type { AuditLogEntry } from "../schema/audit_log.js";

export interface RecordAuditEntryInput {
  /** Null for an unauthenticated event, such as a rejected sign-in. */
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
}

/**
 * Appends one entry.
 *
 * This is the only write in this file, and it is the only write this table
 * accepts: there is no `updateAuditEntry` and no `deleteAuditEntry` here
 * because there is no UPDATE or DELETE policy on the table and `legal_app`
 * holds neither privilege. A function attempting either would fail at run time;
 * its real cost would be suggesting to a reader that the trail is editable.
 *
 * `firm_id` comes from the transaction's tenant context and cannot be passed,
 * exactly as for every other tenant write. An entry therefore lands in the firm
 * whose context the action itself ran in — the two cannot diverge, because
 * there is no second place to state it.
 *
 * Taking `tx` rather than a client is what makes the entry share the action's
 * transaction. See the audit service in apps/api for why that matters.
 */
export async function recordAuditEntry(
  tx: TenantTransaction,
  input: RecordAuditEntryInput,
): Promise<void> {
  const firmId = await currentFirmId(tx);

  await tx.insert(auditLog).values({
    firmId,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    detail: input.detail ?? null,
    ip: input.ip ?? null,
  });
}

/**
 * The firm's trail, most recent first.
 *
 * Scoped to the firm by policy, and to nothing else. Deciding *which* people in
 * a firm may read it is an authorization question for the route that calls
 * this, not something to bury in a repository default.
 */
export async function listAuditEntries(
  tx: TenantTransaction,
  options: { limit: number },
): Promise<AuditLogEntry[]> {
  return tx
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(options.limit);
}

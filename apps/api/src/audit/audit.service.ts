import { Injectable } from "@nestjs/common";
import { recordAuditEntry, type TenantTransaction } from "@legal/db";

/**
 * Every action this platform records, as a closed set.
 *
 * A union rather than free text, for the same reason permissions are a
 * catalogue: the audit trail is only searchable if the thing being searched for
 * has one spelling. `auth.logout` in one file and `auth.log_out` in another
 * produces a trail that answers "show me every sign-out" incorrectly, and
 * silently, and forever — the rows cannot be corrected afterwards.
 *
 * Dotted and past tense: this table records what happened, not what was
 * attempted or intended.
 */
export type AuditAction =
  | "auth.login.succeeded"
  | "auth.login.failed"
  | "auth.logout"
  | "cases.created"
  | "cases.updated"
  | "cases.assigned";

export interface AuditEvent {
  action: AuditAction;
  /** What kind of thing the action was about — `session`, later `case`. */
  resourceType: string;
  resourceId?: string | null;
  /** Null for an unauthenticated event, such as a rejected sign-in. */
  actorUserId?: string | null;
  /**
   * Context that makes the entry readable a year from now. Never a secret:
   * this table outlives the thing it describes and is meant to be disclosable
   * to the firm it belongs to, so no password, token, or document content.
   */
  detail?: Record<string, unknown> | null;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  /**
   * Records an entry **inside the caller's transaction**.
   *
   * The transaction is a parameter and there is deliberately no overload that
   * opens its own. That single design choice is what makes the trail true, and
   * it is worth being explicit about why, because the convenient alternative —
   * an audit service holding its own connection, called after the work — is
   * wrong in both directions at once:
   *
   *   * The action commits, the audit write fails. Now something happened that
   *     the record denies. This is the failure that matters: a trail with holes
   *     is not a weaker trail, it is an unusable one, because nobody can tell a
   *     missing entry from an action that never occurred. Every promise in
   *     docs/threat-model.md that rests on attribution — the departing employee
   *     who took files, the support session that reached a firm's data — rests
   *     on there being no such hole.
   *   * The audit write commits, the action rolls back. Now the record asserts
   *     something that never happened. Against an opposing party arguing the
   *     history is untrustworthy, an entry for an event that demonstrably did
   *     not occur is the exhibit they were hoping for.
   *
   * Sharing the transaction collapses both: the entry and the action are one
   * write to the database, and there is no interleaving in which one exists
   * without the other. The cost is that an audit failure aborts the action —
   * a sign-in that cannot be recorded does not happen. That is the correct
   * direction to fail for a system whose records are the product.
   *
   * `firm_id` is not a parameter here either. It comes from the tenant context
   * the transaction already carries, so an entry cannot be filed against a
   * different firm from the one the action ran in.
   */
  async record(tx: TenantTransaction, event: AuditEvent): Promise<void> {
    await recordAuditEntry(tx, {
      actorUserId: event.actorUserId ?? null,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId ?? null,
      detail: event.detail ?? null,
      ip: event.ip ?? null,
    });
  }
}

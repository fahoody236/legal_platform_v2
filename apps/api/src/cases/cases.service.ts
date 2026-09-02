import { Inject, Injectable } from "@nestjs/common";
import {
  assignCase,
  createCase,
  findCaseById,
  listCases,
  updateCase,
  withTenant,
  type Case,
  type CreateCaseInput,
  type Database,
  type ListCasesFilters,
  type ListCasesResult,
  type UpdateCaseInput,
} from "@legal/db";
import { AuditService } from "../audit/audit.service.js";
import { DATABASE } from "../database/database.module.js";

/**
 * Who is doing this, and from where. Assembled by the controller from the
 * session and the tenant middleware — never from the request body, so a caller
 * cannot name the firm they act in or the person they act as.
 */
export interface Actor {
  firmId: string;
  userId: string;
  ip: string | null;
}

@Injectable()
export class CasesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: Actor,
    filters: ListCasesFilters,
  ): Promise<ListCasesResult> {
    return withTenant(this.db, actor.firmId, (tx) => listCases(tx, filters));
  }

  async findById(actor: Actor, id: string): Promise<Case | undefined> {
    return withTenant(this.db, actor.firmId, (tx) => findCaseById(tx, id));
  }

  /**
   * Every write below records its audit entry inside the same transaction as
   * the change, so a case cannot exist without the trail saying who opened it
   * and the trail cannot claim an edit that rolled back. See AuditService for
   * why sharing the transaction is the whole point.
   *
   * What goes in `detail` is chosen, not dumped. Ids, the case number, and
   * status transitions — values from controlled vocabularies or that are
   * already keys — rather than titles and court names. Case content is client
   * data, and the audit log is the one table nothing can edit or delete: copying
   * a title into it means a typo in a case title is permanent somewhere, and a
   * second copy of client data exists in a table with different access rules
   * from the first.
   */
  async create(actor: Actor, input: CreateCaseInput): Promise<Case> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const created = await createCase(tx, input);

      await this.audit.record(tx, {
        action: "cases.created",
        resourceType: "case",
        resourceId: created.id,
        actorUserId: actor.userId,
        detail: {
          caseNumber: created.caseNumber,
          clientId: created.clientId,
          status: created.status,
          assignedLawyerId: created.assignedLawyerId,
        },
        ip: actor.ip,
      });

      return created;
    });
  }

  /**
   * Undefined means the case is not visible in this tenant context — unknown id
   * and another firm's id alike. Nothing is written in that case, including no
   * audit entry: an attempt to edit a case that this firm cannot see is not an
   * edit, and recording it would put another firm's case id in this firm's
   * permanent trail.
   */
  async update(
    actor: Actor,
    id: string,
    input: UpdateCaseInput,
  ): Promise<Case | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      // Read first, so the entry can say what the status changed *from*. Same
      // transaction, so nothing can move underneath between the two.
      const before = await findCaseById(tx, id);

      if (!before) {
        return undefined;
      }

      const updated = await updateCase(tx, id, input);

      if (!updated) {
        return undefined;
      }

      await this.audit.record(tx, {
        action: "cases.updated",
        resourceType: "case",
        resourceId: updated.id,
        actorUserId: actor.userId,
        detail: {
          // Which fields were touched, not what they now say.
          changed: Object.keys(input).sort(),
          ...(before.status === updated.status
            ? {}
            : { status: { from: before.status, to: updated.status } }),
        },
        ip: actor.ip,
      });

      return updated;
    });
  }

  async assign(
    actor: Actor,
    id: string,
    lawyerId: string | null,
  ): Promise<Case | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const before = await findCaseById(tx, id);

      if (!before) {
        return undefined;
      }

      const updated = await assignCase(tx, id, lawyerId);

      if (!updated) {
        return undefined;
      }

      await this.audit.record(tx, {
        action: "cases.assigned",
        resourceType: "case",
        resourceId: updated.id,
        actorUserId: actor.userId,
        // Both ends recorded. "Who was taken off this matter" is as much a
        // question a firm asks as "who was put on it", and the previous holder
        // is unrecoverable from the row once it is overwritten.
        detail: {
          from: before.assignedLawyerId,
          to: updated.assignedLawyerId,
        },
        ip: actor.ip,
      });

      return updated;
    });
  }
}

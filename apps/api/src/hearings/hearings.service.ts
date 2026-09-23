import { Inject, Injectable } from "@nestjs/common";
import {
  createHearing,
  findHearingById,
  listHearings,
  setHearingStatus,
  updateHearing,
  withTenant,
  type Database,
  type Hearing,
  type HearingWithCase,
  type ListHearingsFilters,
  type ListHearingsResult,
  type UpdateHearingInput,
} from "@legal/db";
import { AuditService } from "../audit/audit.service.js";
import type { Actor } from "../common/request-context.js";
import { DATABASE } from "../database/database.module.js";
import type {
  AdjournHearingInput,
  CreateHearingInput,
  SetHearingStatusInput,
} from "./dto.js";

/** What an adjournment produced: the closed hearing, and its successor if any. */
export interface AdjournResult {
  hearing: Hearing;
  next: Hearing | null;
}

@Injectable()
export class HearingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: Actor,
    filters: ListHearingsFilters,
  ): Promise<ListHearingsResult> {
    return withTenant(this.db, actor.firmId, (tx) => listHearings(tx, filters));
  }

  async findById(
    actor: Actor,
    id: string,
  ): Promise<HearingWithCase | undefined> {
    return withTenant(this.db, actor.firmId, (tx) => findHearingById(tx, id));
  }

  /**
   * `created_by_user_id` comes from the session, never the body. Who put a
   * court date in the file is part of what the record means, and a field a
   * caller could set would make it an assertion rather than a fact.
   */
  async create(actor: Actor, input: CreateHearingInput): Promise<Hearing> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const created = await createHearing(tx, {
        caseId: input.caseId,
        scheduledAt: input.scheduledAt,
        court: input.court ?? null,
        circuit: input.circuit ?? null,
        hearingType: input.hearingType,
        createdByUserId: actor.userId,
      });

      await this.audit.record(tx, {
        action: "hearings.created",
        resourceType: "hearing",
        resourceId: created.id,
        actorUserId: actor.userId,
        // Keys and controlled values, never content: the date a firm is due in
        // court is the fact worth having, and `notes` is deliberately absent
        // from every entry here — it is free text about a client's matter.
        detail: {
          caseId: created.caseId,
          scheduledAt: created.scheduledAt.toISOString(),
          hearingType: created.hearingType,
        },
        ip: actor.ip,
      });

      return created;
    });
  }

  async update(
    actor: Actor,
    id: string,
    input: UpdateHearingInput,
  ): Promise<Hearing | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const before = await findHearingById(tx, id);

      if (!before) {
        return undefined;
      }

      const updated = await updateHearing(tx, id, input);

      if (!updated) {
        return undefined;
      }

      await this.audit.record(tx, {
        action: "hearings.updated",
        resourceType: "hearing",
        resourceId: updated.id,
        actorUserId: actor.userId,
        detail: {
          caseId: updated.caseId,
          changed: Object.keys(input).sort(),
          // A postponement by editing the date is not an adjournment, but it
          // is the thing most worth seeing in a list of edits, so both ends
          // are recorded where they differ.
          ...(before.scheduledAt.getTime() === updated.scheduledAt.getTime()
            ? {}
            : {
                scheduledAt: {
                  from: before.scheduledAt.toISOString(),
                  to: updated.scheduledAt.toISOString(),
                },
              }),
        },
        ip: actor.ip,
      });

      return updated;
    });
  }

  async setStatus(
    actor: Actor,
    id: string,
    input: SetHearingStatusInput,
  ): Promise<Hearing | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const before = await findHearingById(tx, id);

      if (!before) {
        return undefined;
      }

      const updated = await setHearingStatus(
        tx,
        id,
        input.status,
        input.notes === undefined ? undefined : (input.notes ?? null),
      );

      if (!updated) {
        return undefined;
      }

      await this.audit.record(tx, {
        action: "hearings.status_changed",
        resourceType: "hearing",
        resourceId: updated.id,
        actorUserId: actor.userId,
        detail: {
          caseId: updated.caseId,
          from: before.status,
          to: updated.status,
          notesRecorded: input.notes !== undefined && input.notes !== null,
        },
        ip: actor.ip,
      });

      return updated;
    });
  }

  /**
   * Adjournment, as one transaction: this hearing closes and its successor
   * opens, or neither does.
   *
   * The pairing lives here rather than in the database because a trigger
   * demanding a successor would be wrong — courts adjourn without a date, and
   * the record has to be able to say so. See migration 0017.
   *
   * Two rows, one audit entry. An adjournment is a single event in the life of
   * a matter, and splitting it into a status change plus an unrelated creation
   * would make it unreadable in the feed. The entry carries both ids, so the
   * chain is reconstructible from the trail.
   */
  async adjourn(
    actor: Actor,
    id: string,
    input: AdjournHearingInput,
  ): Promise<AdjournResult | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const before = await findHearingById(tx, id);

      if (!before) {
        return undefined;
      }

      const closed = await setHearingStatus(
        tx,
        id,
        "adjourned",
        input.notes === undefined ? undefined : (input.notes ?? null),
      );

      if (!closed) {
        return undefined;
      }

      const next = input.scheduledAt
        ? await createHearing(tx, {
            caseId: before.caseId,
            scheduledAt: input.scheduledAt,
            // The successor inherits the bench and the purpose unless told
            // otherwise: an adjourned matter usually returns to the same
            // circuit for the same reason.
            court: input.court === undefined ? before.court : input.court,
            circuit:
              input.circuit === undefined ? before.circuit : input.circuit,
            hearingType: input.hearingType ?? before.hearingType,
            createdByUserId: actor.userId,
          })
        : null;

      await this.audit.record(tx, {
        action: "hearings.adjourned",
        resourceType: "hearing",
        resourceId: closed.id,
        actorUserId: actor.userId,
        detail: {
          caseId: closed.caseId,
          from: before.status,
          adjournedFrom: before.scheduledAt.toISOString(),
          // Null when the court set no date. That is a real outcome, not a
          // missing value, and the entry says so rather than omitting the key.
          nextHearingId: next?.id ?? null,
          nextScheduledAt: next?.scheduledAt.toISOString() ?? null,
          notesRecorded: input.notes !== undefined && input.notes !== null,
        },
        ip: actor.ip,
      });

      return { hearing: closed, next };
    });
  }
}

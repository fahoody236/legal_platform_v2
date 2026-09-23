import { Inject, Injectable } from "@nestjs/common";
import {
  countCasesByStatus,
  listEffectivePermissions,
  listRecentActivity,
  listUpcomingDeadlines,
  listUpcomingHearings,
  summariseMyTasks,
  withTenant,
  type ActivityResourceType,
  type CaseStatus,
  type Database,
  type HearingType,
  type MyTaskSummary,
} from "@legal/db";
import type { Actor } from "../common/request-context.js";
import { DATABASE } from "../database/database.module.js";
import { activityText } from "./activity-text.js";

const DUE_SOON_DAYS = 7;
const DEADLINE_WINDOW_DAYS = 14;
const DEADLINE_LIMIT = 10;
const HEARING_WINDOW_DAYS = 14;
const HEARING_LIMIT = 10;
const ACTIVITY_LIMIT = 10;

export interface DashboardActivity {
  id: string;
  occurredAt: string;
  /** Rendered Arabic. The raw key rides along for anything that wants it. */
  text: string;
  action: string;
  actor: { name: string; disabled: boolean } | null;
  /** Where the entry leads, when its record has a page. */
  link: { type: "case"; id: string } | { type: "client"; id: string } | null;
}

export interface DashboardResponse {
  /**
   * Each section is absent — not empty — when the caller lacks the permission
   * for it. The interface must not read an absent section as "nothing here".
   */
  cases?: { byStatus: Record<CaseStatus, number>; total: number };
  myTasks?: MyTaskSummary & { dueSoonDays: number };
  upcoming?: {
    windowDays: number;
    items: Array<{
      caseId: string;
      caseNumber: string;
      caseTitleAr: string;
      dueAt: string;
      taskTitleAr: string;
      taskAssignedToName: string | null;
    }>;
  };
  /**
   * Court dates, kept separate from `upcoming` rather than merged into it. A
   * hearing means being somewhere in person on a given morning; a task due
   * date means work owed. One list would make them look interchangeable.
   */
  hearings?: {
    windowDays: number;
    items: Array<{
      id: string;
      caseId: string;
      caseNumber: string;
      caseTitleAr: string;
      scheduledAt: string;
      hearingType: HearingType;
      court: string | null;
      circuit: string | null;
      assignedLawyerName: string | null;
    }>;
  };
  activity?: { items: DashboardActivity[] };
}

@Injectable()
export class DashboardService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * One transaction, five reads at most, each behind the same permission that
   * gates the list it summarises. A section the caller may not see is not
   * queried at all — its count never leaves the database.
   *
   * The activity feed is gated per resource type rather than as a whole: with
   * `cases.view` alone it shows case entries and nothing about clients or
   * tasks. Auth events are never in it — see listRecentActivity.
   */
  async build(actor: Actor): Promise<DashboardResponse> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const permissions = new Set(
        await listEffectivePermissions(tx, actor.userId),
      );
      const canSeeCases = permissions.has("cases.view");
      const canSeeTasks = permissions.has("tasks.view");
      const canSeeClients = permissions.has("clients.view");
      const canSeeHearings = permissions.has("hearings.view");

      const response: DashboardResponse = {};

      if (canSeeCases) {
        const byStatus = await countCasesByStatus(tx);
        response.cases = {
          byStatus,
          total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
        };
      }

      if (canSeeTasks) {
        response.myTasks = {
          ...(await summariseMyTasks(tx, actor.userId, DUE_SOON_DAYS)),
          dueSoonDays: DUE_SOON_DAYS,
        };
      }

      // Deadlines are tasks on cases, so both permissions apply: without
      // cases.view the case is not the reader's to see, and without tasks.view
      // neither is the dated work that makes it a deadline.
      if (canSeeCases && canSeeTasks) {
        const items = await listUpcomingDeadlines(
          tx,
          DEADLINE_WINDOW_DAYS,
          DEADLINE_LIMIT,
        );
        response.upcoming = {
          windowDays: DEADLINE_WINDOW_DAYS,
          items: items.map((item) => ({
            caseId: item.caseId,
            caseNumber: item.caseNumber,
            caseTitleAr: item.caseTitleAr,
            dueAt: item.dueAt.toISOString(),
            taskTitleAr: item.taskTitleAr,
            taskAssignedToName: item.taskAssignedToName,
          })),
        };
      }

      // Both permissions, for the same reason deadlines need both: without
      // cases.view the matter is not the reader's to see, and without
      // hearings.view neither are its court dates.
      if (canSeeCases && canSeeHearings) {
        const items = await listUpcomingHearings(
          tx,
          HEARING_WINDOW_DAYS,
          HEARING_LIMIT,
        );
        response.hearings = {
          windowDays: HEARING_WINDOW_DAYS,
          items: items.map((item) => ({
            id: item.id,
            caseId: item.caseId,
            caseNumber: item.caseNumber,
            caseTitleAr: item.caseTitleAr,
            scheduledAt: item.scheduledAt.toISOString(),
            hearingType: item.hearingType,
            court: item.court,
            circuit: item.circuit,
            assignedLawyerName: item.assignedLawyerName,
          })),
        };
      }

      const visibleTypes: ActivityResourceType[] = [];
      if (canSeeCases) visibleTypes.push("case");
      if (canSeeClients) visibleTypes.push("client", "client_representative");
      if (canSeeTasks) visibleTypes.push("task");
      if (canSeeHearings) visibleTypes.push("hearing");

      if (visibleTypes.length > 0) {
        const entries = await listRecentActivity(
          tx,
          visibleTypes,
          ACTIVITY_LIMIT,
        );

        response.activity = {
          items: entries.map((entry) => ({
            id: entry.id,
            occurredAt: entry.occurredAt.toISOString(),
            text: activityText(entry),
            action: entry.action,
            actor: resolveActor(entry),
            link: resolveLink(entry),
          })),
        };
      }

      return response;
    });
  }
}

/**
 * Three states, only one of which the schema permits to be reached.
 *
 *   * `actorUserId` null — an unauthenticated event. Not in this feed today
 *     (auth entries are excluded), but the shape allows it: `actor` is null and
 *     the interface says "غير مصادق".
 *   * Name resolved, user disabled — a colleague who has left. Attribution is
 *     the whole point of never deleting users, so the name stays and is marked.
 *   * Id present, name null — the user row is gone. That cannot happen through
 *     the application; it means a superuser removed it, which the threat model
 *     names as out of scope. Rendered as "مستخدم غير معروف" so the entry still
 *     reads, and so the anomaly is visible rather than silent.
 */
function resolveActor(entry: {
  actorUserId: string | null;
  actorName: string | null;
  actorDisabled: boolean;
}): DashboardActivity["actor"] {
  if (entry.actorUserId === null) return null;

  return {
    name: entry.actorName ?? "مستخدم غير معروف",
    disabled: entry.actorDisabled,
  };
}

function resolveLink(entry: {
  resourceType: string;
  caseId: string | null;
  clientId: string | null;
}): DashboardActivity["link"] {
  // Tasks and hearings live on their case's page; representatives on their
  // client's. Neither has a page of its own, and neither should: both are
  // sections of the matter they belong to.
  if (
    (entry.resourceType === "case" ||
      entry.resourceType === "task" ||
      entry.resourceType === "hearing") &&
    entry.caseId
  ) {
    return { type: "case", id: entry.caseId };
  }

  if (
    (entry.resourceType === "client" ||
      entry.resourceType === "client_representative") &&
    entry.clientId
  ) {
    return { type: "client", id: entry.clientId };
  }

  return null;
}

import { Inject, Injectable } from "@nestjs/common";
import {
  countCasesByStatus,
  listEffectivePermissions,
  listRecentActivity,
  listUpcomingDeadlines,
  summariseMyTasks,
  withTenant,
  type ActivityResourceType,
  type CaseStatus,
  type Database,
  type MyTaskSummary,
} from "@legal/db";
import type { Actor } from "../common/request-context.js";
import { DATABASE } from "../database/database.module.js";
import { activityText } from "./activity-text.js";

const DUE_SOON_DAYS = 7;
const DEADLINE_WINDOW_DAYS = 14;
const DEADLINE_LIMIT = 10;
const ACTIVITY_LIMIT = 10;

export interface DashboardActivity {
  id: string;
  occurredAt: string;
  /** Rendered Arabic. The raw key rides along for anything that wants it. */
  text: string;
  action: string;
  actor: { name: string; disabled: boolean } | null;
  /** Where the entry leads, when its record has a page. */
  link:
    | { type: "case"; id: string }
    | { type: "client"; id: string }
    | null;
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
  activity?: { items: DashboardActivity[] };
}

@Injectable()
export class DashboardService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * One transaction, four reads at most, each behind the same permission that
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

      const visibleTypes: ActivityResourceType[] = [];
      if (canSeeCases) visibleTypes.push("case");
      if (canSeeClients) visibleTypes.push("client", "client_representative");
      if (canSeeTasks) visibleTypes.push("task");

      if (visibleTypes.length > 0) {
        const entries = await listRecentActivity(tx, visibleTypes, ACTIVITY_LIMIT);

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
function resolveActor(
  entry: { actorUserId: string | null; actorName: string | null; actorDisabled: boolean },
): DashboardActivity["actor"] {
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
  // Tasks live on their case's page; representatives on their client's.
  if ((entry.resourceType === "case" || entry.resourceType === "task") && entry.caseId) {
    return { type: "case", id: entry.caseId };
  }

  if (
    (entry.resourceType === "client" || entry.resourceType === "client_representative") &&
    entry.clientId
  ) {
    return { type: "client", id: entry.clientId };
  }

  return null;
}

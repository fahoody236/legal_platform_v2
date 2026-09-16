import { Inject, Injectable } from "@nestjs/common";
import {
  listEffectivePermissions,
  searchCases,
  searchClients,
  searchTasks,
  withTenant,
  type CaseHit,
  type ClientHit,
  type Database,
  type SearchGroup,
  type TaskHit,
} from "@legal/db";
import type { Actor } from "../common/request-context.js";
import { DATABASE } from "../database/database.module.js";

/** Rows per group. Enough to recognise the record; the group's page has the rest. */
const PER_GROUP = 5;

export interface SearchResponse {
  /**
   * A group is absent — not empty — when the caller lacks the permission to
   * see it. An empty group means "nothing matched"; an absent one means "you
   * would not be shown this even if it did". The interface must not conflate
   * them, and the shape is what stops it.
   */
  clients?: SearchGroup<ClientHit>;
  cases?: SearchGroup<CaseHit>;
  tasks?: SearchGroup<TaskHit>;
}

@Injectable()
export class SearchService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * One search, gated per group.
   *
   * The same permissions that gate each list gate its group here — `clients.view`,
   * `cases.view`, `tasks.view` — resolved once, inside the same transaction the
   * queries run in. A caller without one of them gets the other groups and no
   * 403, because being unable to see clients is not a reason to be unable to
   * find a case.
   *
   * The permission check is a decision about which queries to *run*, not a
   * filter on their results. A group the caller may not see is never queried,
   * so nothing about it — not even its count — leaves the database.
   *
   * All three groups run in one transaction rather than three, so they see one
   * consistent snapshot and a record moving between them mid-search cannot
   * appear in both or neither.
   */
  async search(actor: Actor, term: string): Promise<SearchResponse> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const permissions = new Set(
        await listEffectivePermissions(tx, actor.userId),
      );

      const response: SearchResponse = {};

      if (permissions.has("clients.view")) {
        response.clients = await searchClients(tx, term, PER_GROUP);
      }

      if (permissions.has("cases.view")) {
        response.cases = await searchCases(tx, term, PER_GROUP);
      }

      if (permissions.has("tasks.view")) {
        response.tasks = await searchTasks(tx, term, PER_GROUP);
      }

      return response;
    });
  }
}

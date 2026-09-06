import { Inject, Injectable } from "@nestjs/common";
import { listUsers, withTenant, type Database } from "@legal/db";
import type { Actor } from "../common/request-context.js";
import { DATABASE } from "../database/database.module.js";

/**
 * A user as the firm's own directory sees them.
 *
 * A deliberately narrow projection of the `users` row. It carries what an
 * interface needs to name a colleague and nothing else — no `created_at`, no
 * `firm_id`, and nothing that could later be added to the table without someone
 * choosing to expose it here. The table is where credentials and session
 * ownership hang off, so "return the row" is the wrong default for it.
 */
export interface DirectoryUser {
  id: string;
  fullName: string;
  fullNameAr: string | null;
  email: string;
  /** Null while active. Carries when, not just whether — both are useful. */
  disabledAt: string | null;
}

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(
    actor: Actor,
    options: { includeDisabled: boolean },
  ): Promise<DirectoryUser[]> {
    const rows = await withTenant(this.db, actor.firmId, (tx) =>
      listUsers(tx, { includeDisabled: options.includeDisabled }),
    );

    return rows.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      fullNameAr: row.fullNameAr,
      email: row.email,
      disabledAt: row.disabledAt?.toISOString() ?? null,
    }));
  }
}

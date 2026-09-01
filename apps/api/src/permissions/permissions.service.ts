import { Inject, Injectable } from "@nestjs/common";
import {
  listEffectivePermissions,
  withTenant,
  type Database,
} from "@legal/db";
import { DATABASE } from "../database/database.module.js";

@Injectable()
export class PermissionsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * The permissions this user holds right now.
   *
   * Read on every request and cached nowhere, which is the decision recorded in
   * docs/decisions/0004-permissions.md: a role edited at 10:00 is in force on
   * the next request, so revocation has no window in which it has not taken
   * effect. The cost is one indexed query per gated request — the right trade
   * when the failure mode of staleness is someone reading a file they were just
   * denied.
   *
   * If a cache is ever added, its key has to carry something that changes when
   * the role changes. A per-user TTL is the version of this that looks fine in
   * review and quietly reintroduces the window.
   *
   * `firmId` comes from the Host header via the tenant middleware and `userId`
   * from the validated session, so neither is caller-supplied. The lookup runs
   * inside `withTenant`, which means the policies would return nothing for a
   * user in another firm even if one were somehow named here.
   */
  async effectivePermissions(
    firmId: string,
    userId: string,
  ): Promise<ReadonlySet<string>> {
    const keys = await withTenant(this.db, firmId, (tx) =>
      listEffectivePermissions(tx, userId),
    );

    return new Set(keys);
  }
}

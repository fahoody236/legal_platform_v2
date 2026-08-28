import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

export interface ConnectionRole {
  name: string;
  isSuperuser: boolean;
  bypassesRls: boolean;
  /** False when row-level security is not applied to this connection at all. */
  rlsApplies: boolean;
}

/**
 * Reports whether the row-level security policies actually govern this
 * connection.
 *
 * Role attributes in PostgreSQL are never inherited through role membership, so
 * the current role's own row in pg_roles is the complete answer — there is no
 * transitive BYPASSRLS to chase.
 */
export async function inspectConnectionRole(
  db: Database,
): Promise<ConnectionRole> {
  const result = await db.execute<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
  }>(
    sql`select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Could not resolve the current database role.");
  }

  return {
    name: row.rolname,
    isSuperuser: row.rolsuper,
    bypassesRls: row.rolbypassrls,
    rlsApplies: !row.rolsuper && !row.rolbypassrls,
  };
}

/**
 * Fails fast when the application is connected as a role that ignores
 * row-level security.
 *
 * This is worth a startup check rather than a code review note because of how
 * the failure presents. A superuser, or any role holding BYPASSRLS, does not
 * error on a cross-tenant read — it succeeds. The policies stay in the catalog,
 * are simply never consulted, and every query returns more than it should while
 * looking entirely correct. There is no symptom to notice: the isolation tests
 * would pass against a properly-scoped test role while production quietly
 * served every firm's data to every firm.
 *
 * Refusing to boot is the only reliable signal.
 *
 * See docs/decisions/0002-tenant-isolation.md.
 */
export async function assertRlsAppliesToConnection(
  db: Database,
): Promise<ConnectionRole> {
  const role = await inspectConnectionRole(db);

  if (role.rlsApplies) {
    return role;
  }

  const reason = role.isSuperuser ? "is a superuser" : "holds BYPASSRLS";

  throw new Error(
    `Refusing to start: the application is connected as "${role.name}", which ${reason}. ` +
      `PostgreSQL does not apply row-level security to such a role, so tenant isolation ` +
      `would not be enforced by the database and cross-tenant reads would succeed silently. ` +
      `Point DATABASE_URL at the unprivileged "legal_app" role created by migration 0003.`,
  );
}

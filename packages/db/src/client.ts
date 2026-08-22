/**
 * The connection string handed to `createClient` must belong to an unprivileged
 * database role — never a superuser, and never a role with BYPASSRLS.
 *
 * PostgreSQL skips row-level security entirely for such roles. The policies
 * would still be present in the schema and would simply do nothing at runtime,
 * so tenant isolation would appear to be enforced while every firm could read
 * every other firm's data. Nothing about that failure looks wrong from the
 * application side.
 *
 * See docs/decisions/0002-tenant-isolation.md.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

/**
 * Builds a Drizzle client over its own connection pool, returning both: the
 * pool is what a caller needs to shut the connections down, and a test or
 * migration that cannot close its pool leaves the process hanging.
 *
 * The connection string is a parameter rather than something read from the
 * environment here, so that callers — the API, migrations, and tests — decide
 * which role they connect as, and a test can hold two clients on two different
 * roles at once.
 */
export function createClient(connectionString: string): {
  db: NodePgDatabase;
  pool: pg.Pool;
} {
  const pool = new pg.Pool({ connectionString });
  return { db: drizzle(pool), pool };
}

export type Database = NodePgDatabase;

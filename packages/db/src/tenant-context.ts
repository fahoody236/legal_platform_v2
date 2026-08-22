import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

/** The transaction handle Drizzle hands to a `db.transaction` callback. */
export type TenantTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `callback` in a transaction bound to one firm.
 *
 * `set_config(..., true)` with its third argument true is the transaction-local
 * form — exactly what SET LOCAL does, discarded on commit or rollback. That
 * scoping is the point: the setting cannot survive on a pooled connection and
 * be inherited by whichever request borrows that connection next. With a
 * session-wide setting, one request would silently hand its tenant context to
 * the following one, a cross-tenant read no code review would spot because
 * every query involved looks correct.
 *
 * Unlike SET LOCAL, `set_config` is an ordinary function call, so `firmId`
 * travels as a bound parameter rather than as statement text. There is no
 * interpolation to get wrong: the value cannot alter the shape of the
 * statement, whatever it contains.
 *
 * The UUID check is therefore defence in depth rather than the security
 * boundary. It still earns its place — it turns a malformed id into a clear
 * error here instead of a cast failure surfacing mid-transaction from whichever
 * policy first compares the setting to a `uuid` column.
 *
 * Row-level security policies compare `firm_id` against this setting. When it
 * is absent, `current_setting('app.current_firm_id', true)` is NULL, the policy
 * predicate is NULL, and no row qualifies. The failure mode is an empty result,
 * never another firm's data.
 */
export async function withTenant<T>(
  db: Database,
  firmId: string,
  callback: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (!UUID.test(firmId)) {
    // Not echoed into any response: a malformed tenant id is a bug or an
    // attack, and neither wants an oracle.
    throw new Error("withTenant requires a UUID firm id");
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_firm_id', ${firmId}, true)`,
    );
    return callback(tx);
  });
}

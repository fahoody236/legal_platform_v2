/**
 * The public surface of @legal/db.
 *
 * This is the whole of it. The `exports` map in package.json lists only ".",
 * so Node itself refuses `@legal/db/schema` at runtime — the repository
 * boundary is enforced by the module resolver, not only by a lint rule that a
 * dynamic import could sidestep.
 *
 * Note what is missing: the tables. Callers get repository functions that take
 * the transaction from `withTenant`, and row types to hold the results. They do
 * not get `users` or `firms`, because holding a table is what makes it possible
 * to build a query that leaves the tenant boundary.
 */

export { createClient } from "./client.js";
export type { Database } from "./client.js";

export { withTenant, currentFirmId } from "./tenant-context.js";
export type { TenantTransaction } from "./tenant-context.js";

export {
  assertRlsAppliesToConnection,
  inspectConnectionRole,
} from "./connection-guard.js";
export type { ConnectionRole } from "./connection-guard.js";

export * from "./repositories/index.js";

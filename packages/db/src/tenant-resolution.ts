import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

/**
 * ── The single sanctioned query that runs outside tenant context ─────────────
 *
 * This file is deliberately alone. Everything else that touches tenant data
 * goes through `repositories/`, takes the transaction from `withTenant`, and is
 * therefore governed by row-level security. This one function is the exception,
 * and it is kept in its own file so that the exception has an obvious shape:
 * one import, one function, one reason.
 *
 * It exists because resolving a hostname to a firm is what *creates* the tenant
 * context every other query depends on. There is no context to run it in
 * (docs/decisions/0003-tenant-identification.md).
 *
 * ── Why this is not the enumeration risk that email lookup would be ──────────
 *
 * ADR 0003 rejected identifying firms by looking up an email address across all
 * firms. Both are context-free reads, so the distinction is worth being precise
 * about — it is not that this one is smaller, it is that it is a different kind
 * of thing.
 *
 * The email lookup is keyed on a *secret-ish personal identifier* and answers a
 * question about a person: does this address exist, and which firm employs
 * them. That is an oracle. An attacker with a list of addresses learns which
 * lawyers work where, which is client-adjacent intelligence in itself, and the
 * component that answers it is inherently a cross-firm user search — the shape
 * that gets reused for password reset, then admin search, then support tooling,
 * until the "no exceptions" property is gone.
 *
 * This lookup is keyed on a *hostname*, which is public by construction. A
 * subdomain is a DNS name: anyone can resolve it, certificate transparency logs
 * publish it, and the firm prints it on its own stationery. Confirming that
 * `alhumoudi.platform.sa` is a tenant reveals nothing DNS did not already. It
 * returns an opaque uuid and no personal data at all, and it cannot be
 * generalised — there is no version of "search users" reachable from a function
 * whose entire signature is text in, uuid out.
 *
 * The unavoidable disclosure is that a subdomain is or is not in service, and
 * that is a property of a public name rather than of anyone's data.
 */
export async function resolveFirmBySubdomain(
  db: Database,
  subdomain: string,
): Promise<string | null> {
  const result = await db.execute<{ firm_id: string | null }>(
    sql`select resolve_firm_by_subdomain(${subdomain}) as firm_id`,
  );

  return result.rows[0]?.firm_id ?? null;
}

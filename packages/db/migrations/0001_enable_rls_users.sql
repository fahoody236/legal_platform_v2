-- Row-level security on users.
--
-- Hand-written: policies, FORCE, and grants are not expressible as a schema
-- diff, so drizzle-kit will neither generate nor manage what follows.
--
-- Fail-closed, in three steps:
--
--   1. ENABLE ROW LEVEL SECURITY makes the table deny-by-default. Once enabled,
--      a command is permitted only where a policy grants it. There is no DELETE
--      policy below, so DELETE is denied outright for everyone subject to RLS —
--      absence of a policy is denial, which is exactly the property wanted for a
--      table where nothing is ever deleted.
--
--   2. FORCE ROW LEVEL SECURITY extends that to the table's owner. Without it,
--      the owner is exempt, and the role that ran the migration would quietly be
--      an exception to the rule the migration exists to create.
--
--   3. current_setting('app.current_firm_id', true) — the second argument is
--      missing_ok. With it, an unset setting returns NULL instead of raising.
--      NULL::uuid = firm_id then evaluates to NULL, not TRUE, and a policy
--      admits a row only on TRUE. So a connection with no tenant context reads
--      the table as empty and can insert nothing.
--
--      This is the load-bearing detail. Had the setting been read without
--      missing_ok, a missing context would raise an error — still safe, but it
--      would push every caller toward wrapping the read in something forgiving,
--      and the forgiving version of "no tenant" is "all tenants". The failure
--      mode here is zero rows, never another firm's rows.
--
-- Superusers and roles with BYPASSRLS ignore all of this. See
-- docs/decisions/0002-tenant-isolation.md.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "users_tenant_select" ON "users"
  FOR SELECT
  USING (current_setting('app.current_firm_id', true)::uuid = firm_id);--> statement-breakpoint

-- INSERT takes WITH CHECK only: there is no existing row to test, so the
-- predicate is applied to the row being written. A caller cannot insert a user
-- into a firm other than its own.
CREATE POLICY "users_tenant_insert" ON "users"
  FOR INSERT
  WITH CHECK (current_setting('app.current_firm_id', true)::uuid = firm_id);--> statement-breakpoint

-- UPDATE needs both: USING decides which rows are visible to update, WITH CHECK
-- decides what they may become. Without WITH CHECK, a caller could take one of
-- its own rows and rewrite firm_id to move it into another firm.
CREATE POLICY "users_tenant_update" ON "users"
  FOR UPDATE
  USING (current_setting('app.current_firm_id', true)::uuid = firm_id)
  WITH CHECK (current_setting('app.current_firm_id', true)::uuid = firm_id);

-- Harden the users tenant policies against a blank tenant setting.
--
-- 0001 tested `current_setting('app.current_firm_id', true)::uuid = firm_id`.
-- That is already fail-closed when the setting is *absent*: missing_ok returns
-- NULL, NULL = firm_id is NULL rather than TRUE, and a policy admits a row only
-- on TRUE.
--
-- It behaves differently when the setting is *present but empty*, which
-- `set_config('app.current_firm_id', '', true)` produces. Then the predicate
-- reaches ''::uuid, and that raises `invalid input syntax for type uuid`. Still
-- fail-closed — no row escapes — but it is a second, louder failure for what is
-- semantically the same condition: no tenant. It surfaces as a cast error from
-- whichever policy happened to evaluate first, which reads like a bug in the
-- query rather than a missing tenant context.
--
-- nullif(..., '') folds both cases into one. Absent or blank, the predicate is
-- NULL and the answer is zero rows.
--
-- Policies cannot be altered in place, so each is dropped and recreated. The
-- migration runs in a transaction, so there is no window in which the table is
-- unprotected: readers either see the old policies or the new ones.

DROP POLICY IF EXISTS "users_tenant_select" ON "users";--> statement-breakpoint

CREATE POLICY "users_tenant_select" ON "users"
  FOR SELECT
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

DROP POLICY IF EXISTS "users_tenant_insert" ON "users";--> statement-breakpoint

-- INSERT takes WITH CHECK only: there is no existing row to test, so the
-- predicate applies to the row being written.
CREATE POLICY "users_tenant_insert" ON "users"
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

DROP POLICY IF EXISTS "users_tenant_update" ON "users";--> statement-breakpoint

-- UPDATE needs both: USING decides which rows may be updated, WITH CHECK decides
-- what they may become — without it, a caller could rewrite firm_id and move one
-- of its own rows into another firm.
CREATE POLICY "users_tenant_update" ON "users"
  FOR UPDATE
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id)
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);

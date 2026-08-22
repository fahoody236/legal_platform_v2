-- Row-level security on firms, closing the gap 0003 flagged.
--
-- 0003 granted SELECT on firms to legal_app so the application can read its own
-- firm record. With no policy on the table, that grant reached every firm row in
-- the database — the tenant directory: the name of every subscribing firm and
-- when each was onboarded. Harmless with one tenant, a cross-tenant disclosure
-- with two.
--
-- firms carries no firm_id, because its own id *is* the tenant key. The
-- predicate is therefore `... = id` rather than `... = firm_id`; everything else
-- matches the users policies from 0001/0002.
--
-- SELECT only, and the omissions are deliberate. Once RLS is enabled the table
-- is deny-by-default, so a command with no policy is refused outright. There is
-- no INSERT policy because firms are created by platform provisioning, not by
-- the application serving a firm; no UPDATE policy because firm settings are not
-- yet editable through the application; and no DELETE policy because nothing is
-- ever deleted. When firm settings do become editable, that is a new policy
-- written on purpose — which is the point of leaving it absent now.
--
-- Fail-closed for the same reason as users: missing_ok makes an unset setting
-- NULL, nullif folds a blank one into NULL as well, NULL = id is NULL rather
-- than TRUE, and a policy admits a row only on TRUE. A connection with no tenant
-- context reads firms as empty.
--
-- FORCE extends the policy to the table's owner, so the role that ran the
-- migration is not a standing exception to it. Superusers and BYPASSRLS roles
-- still ignore all of this — see docs/decisions/0002-tenant-isolation.md.

ALTER TABLE "firms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "firms" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "firms_tenant_select" ON "firms"
  FOR SELECT
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = id);

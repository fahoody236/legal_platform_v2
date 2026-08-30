-- The bootstrap lookup: subdomain -> firm id.
--
-- ── Why this function exists ─────────────────────────────────────────────────
--
-- Every other read in this system runs inside a tenant context. This one cannot,
-- because it is what establishes that context. The firms policy from 0004 tests
-- `id = current_firm_id`, so a context-free SELECT matches nothing — correct,
-- and precisely the reason the resolution query needs somewhere to stand.
--
-- The alternative was a second policy on firms permitting context-free reads.
-- A policy cannot restrict columns, so that would reopen the whole tenant
-- directory — every firm's name and onboarding date to any context-free query —
-- which is the leak 0004 was written to close. A function can restrict what
-- comes back, so the exception is a function.
--
-- ── Why widening the return type would be a security change ──────────────────
--
-- SECURITY DEFINER means this runs with the definer's privileges, not the
-- caller's. Row-level security does not apply inside it. The only thing keeping
-- that safe is that there is nothing here worth stealing: one uuid, derived
-- from a hostname that DNS already publishes.
--
-- Adding a column would change that, and it would not feel like a security
-- change at the time. `RETURNS TABLE (id uuid, name text)` reads like saving a
-- round trip for a page header. What it actually does is turn the one function
-- exempt from row-level security into a context-free reader of firm data, which
-- is the tenant directory again by a different route. The same argument applies
-- to every plausible next column — locale, branding, plan, feature flags — and
-- each one is individually reasonable, which is exactly how this erodes.
--
-- So: the return type is the security boundary. Changing it needs the same
-- scrutiny as changing a policy, not the scrutiny of adding a field.
--
-- ── Properties this signature gives for free ─────────────────────────────────
--
--   * Returns a uuid or NULL. Nothing else can come out.
--   * Archived firms return NULL, identical to an unknown subdomain, so a caller
--     cannot tell "never existed" from "no longer active" — both are a 404.
--   * Takes one scalar and is STABLE, so it cannot be coaxed into returning a
--     set, a join, or anything at all about users.
--   * EXECUTE is granted to legal_app alone. PUBLIC gets nothing, which matters
--     because SECURITY DEFINER functions are executable by PUBLIC by default.

CREATE OR REPLACE FUNCTION resolve_firm_by_subdomain(p_subdomain text)
RETURNS uuid
AS $$
  SELECT id
  FROM firms
  WHERE subdomain = p_subdomain
    AND archived_at IS NULL
  LIMIT 1;
$$
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public;--> statement-breakpoint

REVOKE ALL ON FUNCTION resolve_firm_by_subdomain(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_firm_by_subdomain(text) TO legal_app;

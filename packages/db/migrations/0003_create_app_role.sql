-- The unprivileged role the application connects as.
--
-- This is the role the RLS policies from 0001/0002 are meant to constrain. They
-- do nothing for a superuser or for any role holding BYPASSRLS: the policies
-- stay in the catalog and are simply not consulted, so isolation looks enforced
-- and is not. NOBYPASSRLS is stated explicitly rather than left to the default,
-- because it is the single attribute this whole design rests on.
-- See docs/decisions/0002-tenant-isolation.md.
--
-- What the role deliberately cannot do:
--   * own tables — FORCE ROW LEVEL SECURITY covers owners, but a non-owner
--     cannot ALTER or DROP the table at all, which is the stronger property
--   * create anything — no CREATE on schema public, so no DDL
--   * delete rows — no DELETE grant on users, matching the absence of a DELETE
--     policy in 0001 and the rule that nothing is ever destroyed
--   * reach future tables — grants are explicit per table, never
--     ALTER DEFAULT PRIVILEGES, so a new table is unreadable until someone
--     grants it on purpose. New tables failing closed is the desired default.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- The password is not set here, and must never be.
--
-- A migration is a tracked file in version control. A credential written into
-- one is a credential in every clone, every CI artefact, and every copy of the
-- repository's history, permanently — rotation cannot reach backwards. So the
-- role is created able to log in but with no password set, which fails closed:
-- under scram-sha-256 or md5 authentication a passwordless role cannot
-- authenticate at all until someone supplies one out of band.
--
-- Development: set it from the shell after migrating, reading from the local
-- environment rather than a literal —
--
--     psql "$DATABASE_URL" -c "ALTER ROLE legal_app PASSWORD '$LEGAL_APP_PASSWORD'"
--
-- and keep LEGAL_APP_PASSWORD in .env, which is not committed. A throwaway
-- value is fine locally; what matters is that the habit matches production.
--
-- Production: the password is issued and rotated by the secret manager — the
-- application reads its connection string at boot and never stores it on disk.
-- Better still where the platform offers it, use short-lived IAM database
-- authentication so there is no long-lived password to leak. Either way the
-- deployment pipeline runs the ALTER ROLE, and the value never enters this
-- repository.
--
-- Note for whoever runs this: CREATE ROLE requires the migrating role to hold
-- CREATEROLE or be a superuser. That is a privilege the migration identity has
-- and the application identity must not.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'legal_app') THEN
    CREATE ROLE legal_app
      LOGIN
      NOBYPASSRLS
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE;
  ELSE
    -- Re-assert the attributes without touching an existing password.
    ALTER ROLE legal_app
      LOGIN
      NOBYPASSRLS
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE;
  END IF;
END
$$;--> statement-breakpoint

-- The database name is not known statically, so it is read at run time.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO legal_app', current_database());
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO legal_app;--> statement-breakpoint

-- Usage without create: the role can see and use what exists in the schema and
-- can add nothing to it.
REVOKE CREATE ON SCHEMA public FROM legal_app;--> statement-breakpoint

-- Read-only: a firm's own record is created and maintained through platform
-- provisioning, not by the application serving that firm.
--
-- WARNING: firms has no row-level security yet — 0001 deliberately covered only
-- users. Until a policy exists on firms, this grant lets the application read
-- every firm row in the database, not merely its own. That is the tenant
-- directory: names of every subscribing firm and when each was onboarded.
-- Scope it before the pilot carries a second tenant.
GRANT SELECT ON TABLE "firms" TO legal_app;--> statement-breakpoint

-- Row-level security still applies on top of these grants. The grant says which
-- verbs are possible at all; the policy says which rows they may touch.
GRANT SELECT, INSERT, UPDATE ON TABLE "users" TO legal_app;

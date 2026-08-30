-- The subdomain that identifies a firm before any query runs
-- (docs/decisions/0003-tenant-identification.md).
--
-- Unique globally, not per firm. Everything else in this schema is scoped by
-- firm_id; this column is the one value that must be distinct across the whole
-- platform, because it is what resolves a request to a tenant in the first
-- place. A per-tenant constraint here would be circular.
--
-- ── Existing rows ────────────────────────────────────────────────────────────
--
-- A NOT NULL column with no default cannot be added to a table that has rows,
-- and there is no natural value to derive one from: `name` may be absent from
-- the Latin field, may not be slug-safe, and carries no uniqueness guarantee.
--
-- There is no production data, so the tempting move is to add the column NOT
-- NULL directly and let the migration fail if anything is there. That trades a
-- three-line backfill for a migration that breaks on any developer's database
-- holding a leftover fixture — including one left behind by an interrupted
-- isolation test run. The failure would be confusing and the fix manual.
--
-- So: add nullable, backfill deterministically from the primary key, then set
-- NOT NULL. The generated value — `firm-<uuid without hyphens>` — is unique by
-- construction, satisfies the format check, and is obviously synthetic, so a
-- placeholder cannot be mistaken for a chosen name. On an empty table the
-- backfill is a no-op and the end state is identical.

ALTER TABLE "firms" ADD COLUMN "subdomain" text;--> statement-breakpoint

-- firms carries FORCE ROW LEVEL SECURITY and, since 0004, a SELECT policy only.
-- FORCE applies policies to the table owner too, so this UPDATE would be denied
-- for want of an UPDATE policy — deny-by-default working exactly as intended,
-- against the migration that needs to write. Lifted for the backfill and
-- restored immediately; both statements take an ACCESS EXCLUSIVE lock inside
-- this migration's transaction, so there is no window in which the table is
-- readable without its policy.
ALTER TABLE "firms" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

UPDATE "firms"
	SET "subdomain" = 'firm-' || replace("id"::text, '-', '')
	WHERE "subdomain" IS NULL;--> statement-breakpoint

ALTER TABLE "firms" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "firms" ALTER COLUMN "subdomain" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "firms" ADD CONSTRAINT "firms_subdomain_key" UNIQUE ("subdomain");--> statement-breakpoint

-- 3 to 63 characters, lowercase letters, digits and hyphens, never starting or
-- ending with a hyphen. The three groups give the length bounds directly:
-- 1 + (1..61) + 1.
ALTER TABLE "firms" ADD CONSTRAINT "firms_subdomain_format_check"
	CHECK ("subdomain" ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$');--> statement-breakpoint

-- Names the platform needs for itself. Kept as its own constraint rather than
-- folded into the format check so that a rejection says which rule was broken,
-- and so the list can be revised without touching the format rule.
--
-- Extending the list is a migration, deliberately: reserving a name is a
-- platform decision, and a firm that already holds one has a URL in use.
ALTER TABLE "firms" ADD CONSTRAINT "firms_subdomain_not_reserved_check"
	CHECK ("subdomain" NOT IN ('www', 'api', 'admin', 'app', 'mail', 'static', 'assets'));

-- No grant changes: 0003 granted SELECT on the whole table to legal_app, which
-- covers columns added later.

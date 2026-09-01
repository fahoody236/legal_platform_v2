-- Clients and cases — the first tables holding the thing this platform is for.
--
-- Everything before this migration was machinery: tenants, sign-in, roles,
-- audit. A case is the artefact itself, which changes what the schema owes.
-- Both tables here are legal records under the rule in CLAUDE.md — destroying a
-- row destroys history — so both are archived and neither is deletable, by
-- policy or by grant.
--
-- The composite keys continue the pattern the whole schema rests on. A case
-- references its client as (firm_id, client_id) and its lawyer as
-- (firm_id, assigned_lawyer_id), never by id alone, so a case in firm A cannot
-- name firm B's client or firm B's lawyer. The pair has to exist together in the
-- parent, which makes the cross-firm reference unrepresentable rather than
-- merely rejected by a check someone remembered to write. That matters more here
-- than anywhere so far: this is where a mistake is a privileged document
-- attached to the wrong firm's matter.

CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	-- Latin-script name, following firms and users. Required, because something
	-- has to be.
	"name" text NOT NULL,
	-- Arabic name. Nullable for the same reason as users.full_name_ar: a foreign
	-- corporate client may genuinely have no Arabic name, and requiring one
	-- produces invented transliterations that nobody searches for and nobody
	-- corrects.
	"name_ar" text,
	-- Saudi national ID or iqama. Nullable: a corporate client has none, and a
	-- new matter often opens before the number is to hand.
	"national_id" text,
	-- Contact details and notes are nullable. A client recorded from a first
	-- phone call has a name and nothing else, and the alternative to NULL is an
	-- empty string — which satisfies NOT NULL while looking, to every query and
	-- every screen, exactly like a value that was filled in.
	"phone" text,
	"email" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- Archived, never deleted. A former client's matters remain readable.
	"archived_at" timestamp with time zone,
	-- The anchor every composite reference to a client points at.
	CONSTRAINT "clients_firm_id_id_key" UNIQUE("firm_id","id")
);--> statement-breakpoint

CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	-- The firm's own reference for the matter, as written on its file. Unique
	-- within the firm, not globally: two firms number their matters
	-- independently and will collide constantly.
	"case_number" text NOT NULL,
	"title" text NOT NULL,
	"title_ar" text,
	"case_type" text NOT NULL,
	-- Nullable: not every matter is before a court. Advisory work, contract
	-- drafting and negotiation are cases with no forum.
	"court" text,
	"status" text NOT NULL,
	-- Nullable: a matter can be open and unassigned, which is a real state and
	-- worth being able to query for rather than hiding behind a placeholder.
	"assigned_lawyer_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "cases_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "cases_firm_id_case_number_key" UNIQUE("firm_id","case_number"),

	-- ── Why a CHECK and not an enum ──────────────────────────────────────────
	--
	-- Both express "one of these four values". They differ entirely in what it
	-- costs to be wrong about the four, and this list will be wrong: matter
	-- workflow is firm practice, not a fixed domain like ISO currency codes.
	--
	-- Removing a value from a PostgreSQL enum is not supported at all. There is
	-- no ALTER TYPE ... DROP VALUE. Retiring `pending` would mean creating a new
	-- type, altering every column that uses it, migrating defaults, and dropping
	-- the old type — a multi-statement rewrite against a table holding live
	-- matters. Renaming has the same shape. Here it is DROP CONSTRAINT followed
	-- by ADD CONSTRAINT, in one migration, with the old and new lists both
	-- visible in the diff.
	--
	-- Adding is easier than removing but still sharp: ALTER TYPE ... ADD VALUE
	-- may run inside a transaction on modern PostgreSQL, but the new value
	-- cannot be *used* in that same transaction. A migration that adds a status
	-- and backfills rows to it fails, and it fails at deploy time rather than in
	-- review.
	--
	-- Two smaller reasons. An enum's sort order is its declaration order, so
	-- inserting a value in the middle is a decision about ORDER BY that outlives
	-- whoever made it; a CHECK has no implied order, which is honest, because
	-- these four have none. And an enum type is a global object shared by every
	-- column using it, so two tables that started with the same vocabulary can
	-- never diverge without one of them being rewritten.
	--
	-- What the CHECK gives up: nothing enforces that another column elsewhere
	-- uses the same four values, and the list is duplicated in the Drizzle schema
	-- — mirrored by hand, like RESERVED_SUBDOMAINS. The database stays the
	-- authority; the copy exists so the application can reject a bad value with a
	-- message instead of a constraint violation.
	CONSTRAINT "cases_status_check" CHECK ("status" IN ('open', 'in_progress', 'pending', 'closed'))
);--> statement-breakpoint

ALTER TABLE "clients" ADD CONSTRAINT "clients_firm_id_firms_id_fk"
	FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "cases" ADD CONSTRAINT "cases_firm_id_firms_id_fk"
	FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "cases" ADD CONSTRAINT "cases_firm_id_client_id_clients_firm_id_id_fk"
	FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- MATCH SIMPLE, so an unassigned case skips the check entirely. That is what
-- lets assigned_lawyer_id be nullable without weakening the assigned case.
ALTER TABLE "cases" ADD CONSTRAINT "cases_firm_id_assigned_lawyer_id_users_firm_id_id_fk"
	FOREIGN KEY ("firm_id","assigned_lawyer_id") REFERENCES "public"."users"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- "This client's matters" — the client page, and the check before archiving a
-- client.
CREATE INDEX "cases_firm_id_client_id_idx" ON "cases" USING btree ("firm_id","client_id");--> statement-breakpoint

-- "My cases" — the first screen most users will open, and the question behind
-- every workload view.
CREATE INDEX "cases_firm_id_assigned_lawyer_id_idx" ON "cases" USING btree ("firm_id","assigned_lawyer_id");--> statement-breakpoint

-- "What is open" — the working list, and every count on a dashboard. Counts are
-- computed after tenant filtering, never over the table, because an aggregate is
-- a disclosure (docs/threat-model.md, rival firm's employee).
CREATE INDEX "cases_firm_id_status_idx" ON "cases" USING btree ("firm_id","status");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security
--
-- The established fail-closed form: enabled and forced, SELECT/INSERT/UPDATE,
-- and an absent or blank tenant setting reads as zero rows rather than as every
-- row.
--
-- No DELETE policy and no DELETE grant. These are the legal records the rule in
-- CLAUDE.md is about — a case closed by mistake is reopened, a client entered
-- twice is archived, and neither is destroyed. The distinction that let
-- role_permissions and user_roles have DELETE does not apply: destroying one of
-- these rows destroys history, not a current setting.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clients" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "clients_tenant_select" ON "clients"
  FOR SELECT
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "clients_tenant_insert" ON "clients"
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "clients_tenant_update" ON "clients"
  FOR UPDATE
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id)
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

ALTER TABLE "cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "cases_tenant_select" ON "cases"
  FOR SELECT
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "cases_tenant_insert" ON "cases"
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

-- Both USING and WITH CHECK. USING alone would let a caller move a row out of
-- their firm: the row is visible to update, and nothing would test what firm_id
-- becomes afterwards.
CREATE POLICY "cases_tenant_update" ON "cases"
  FOR UPDATE
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id)
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON TABLE "clients" TO legal_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "cases" TO legal_app;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Catalogue additions
--
-- Six keys, and the splits between them are the product decisions.
--
-- `cases.create`, `cases.edit` and `cases.assign` are separate because firms
-- distribute those three differently: a paralegal who opens matters and updates
-- them is not someone who decides which lawyer carries them. Assignment is the
-- one that allocates work and reveals who is on what, so it is the one a firm is
-- most likely to want held narrowly.
--
-- `clients.view` is separate from `cases.view` because the client list alone is
-- commercially valuable — docs/threat-model.md rates client identities High on
-- their own, independently of the matters.
--
-- Nobody holds any of these until a role grants them. Adding a permission grants
-- nothing.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "permissions" ("key", "resource", "action", "description") VALUES
	('clients.view',   'clients', 'view',   'View the client list and client records'),
	('clients.manage', 'clients', 'manage', 'Create, edit and archive clients'),
	('cases.view',     'cases',   'view',   'View cases and their details'),
	('cases.create',   'cases',   'create', 'Open new cases'),
	('cases.edit',     'cases',   'edit',   'Edit case details, status and closure'),
	('cases.assign',   'cases',   'assign', 'Assign and reassign the lawyer responsible for a case')
ON CONFLICT ("key") DO UPDATE SET
	"resource" = EXCLUDED."resource",
	"action" = EXCLUDED."action",
	"description" = EXCLUDED."description";

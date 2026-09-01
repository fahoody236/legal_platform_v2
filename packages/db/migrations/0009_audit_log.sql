-- The audit log.
--
-- ── What this table is for ───────────────────────────────────────────────────
--
-- docs/threat-model.md rates audit logs "High differently. Not secret so much as
-- load-bearing: if it can be edited, nothing else here is provable." Three of
-- the five adversaries there are answered partly or wholly by this table:
--
--   * The departing employee. Nothing stops someone downloading what they are
--     genuinely entitled to; the control is that it is attributable and
--     reviewable afterwards. That control is this table, and it is worth
--     exactly as much as its resistance to being edited by the person it
--     describes.
--   * The opposing party. Their strongest non-technical route is an argument in
--     court that the record was altered. A trail the application itself cannot
--     rewrite is the difference between demonstrating integrity and asserting
--     it.
--   * The platform insider. Support access is meant to write into the affected
--     firm's own trail, which only means something if that entry cannot later
--     be removed by the same access.
--
-- So the requirement is not "log things". It is that an entry, once committed,
-- cannot be altered or removed by anything the application can do.
--
-- ── How append-only is enforced ──────────────────────────────────────────────
--
-- Two independent mechanisms, either of which would suffice, because this is the
-- table where being wrong is unrecoverable:
--
--   1. No UPDATE or DELETE policy. Row-level security is deny-by-default, so an
--      absent policy is a denial — the same shape as the withheld DELETE on
--      legal records elsewhere in this schema.
--   2. No UPDATE or DELETE grant to legal_app. The privilege is not held in the
--      first place, so the policies are never consulted.
--
-- Note what neither covers: TRUNCATE is not subject to row-level security at
-- all. It is governed by grant alone, and it is not granted here. A future
-- `GRANT ALL ON audit_log TO legal_app` would therefore hand over the ability to
-- empty this table in one statement, with every policy above still in place and
-- still passing review. Grant this table explicitly, or not at all.
--
-- What this does not defend against, and is not meant to: a database superuser.
-- FORCE ROW LEVEL SECURITY binds the table owner, but a role with BYPASSRLS or
-- SUPERUSER ignores policies outright, and the owner can drop them. That is the
-- hosting-insider row of the threat model, answered by in-Kingdom hosting,
-- restricted standing access, and — eventually — hash chaining, which makes
-- alteration detectable rather than impossible. Not built; see the note at the
-- end of this file.

CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	-- Nullable, and deliberately so. The first thing this table must record is a
	-- failed sign-in against an address that matches no user — an unauthenticated
	-- attempt is exactly the event worth having, and there is no actor to name.
	-- A sentinel "anonymous" user row would be worse: it would be a real row in
	-- `users`, joinable, assignable a role, and indistinguishable from a person
	-- in every query that did not know to exclude it.
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"detail" jsonb,
	-- Nullable: not every recorded action arrives over HTTP. A scheduled job or
	-- a migration-time change has no address, and a placeholder string would be
	-- a lie in a table whose value is that it does not contain any.
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- An entry naming nothing is an entry that cannot be read back. These cost
	-- nothing on insert and stop a silently empty string from becoming a
	-- permanent, unremovable hole in the trail.
	CONSTRAINT "audit_log_action_not_blank_check" CHECK ("action" <> ''),
	CONSTRAINT "audit_log_resource_type_not_blank_check" CHECK ("resource_type" <> '')
);--> statement-breakpoint

ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_firm_id_firms_id_fk"
	FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Composite, like every other reference to a user in this schema: an entry in
-- firm A cannot name an actor in firm B, because the pair has to exist together
-- in the parent. MATCH SIMPLE means a NULL actor skips the check entirely, which
-- is what allows the unauthenticated case above without weakening the checked
-- one.
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_firm_id_actor_user_id_users_firm_id_id_fk"
	FOREIGN KEY ("firm_id","actor_user_id") REFERENCES "public"."users"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- "What happened here, most recent first" — the default reading of any firm's
-- trail, and the only one that exists before there is a screen for the others.
CREATE INDEX "audit_log_firm_id_created_at_idx" ON "audit_log" USING btree ("firm_id","created_at" DESC);--> statement-breakpoint

-- "What did this person do" — the departing-employee review. The threat model
-- promises attribution, and attribution nobody can query is a promise about a
-- table scan.
CREATE INDEX "audit_log_firm_id_actor_user_id_created_at_idx" ON "audit_log" USING btree ("firm_id","actor_user_id","created_at" DESC);--> statement-breakpoint

-- "Who touched this document" — the other direction, needed the moment anyone
-- asks about a specific case or file rather than a specific person.
CREATE INDEX "audit_log_firm_id_resource_idx" ON "audit_log" USING btree ("firm_id","resource_type","resource_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security
--
-- SELECT and INSERT only. There is no UPDATE policy and no DELETE policy, and
-- that absence is the control, not an omission — see the header.
--
-- The SELECT policy scopes reads to the firm and stops there. It does not decide
-- *which* people in a firm may read the trail; that is an authorization question
-- and belongs to a permission on the route that serves it. RLS answers the
-- tenant question, which it can answer absolutely.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "audit_log_tenant_select" ON "audit_log"
  FOR SELECT
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "audit_log_tenant_insert" ON "audit_log"
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

-- SELECT and INSERT. Nothing else, ever — not UPDATE, not DELETE, not TRUNCATE,
-- and never ALL.
GRANT SELECT, INSERT ON TABLE "audit_log" TO legal_app;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Deferred: hash chaining
--
-- docs/threat-model.md specifies "a hash-chained append-only audit trail" for
-- the opposing-party adversary. This table is append-only to the application but
-- not tamper-*evident*: a superuser can still alter a row and leave no trace,
-- and nothing here would show it.
--
-- Chaining is a schema change (a previous-hash column, a hash covering the
-- entry and its predecessor) and a serialization requirement on inserts, which
-- is a real cost on the hottest-writing table in the system. It is deliberately
-- not being paid before there is anything to protect. Note for whoever adds it:
-- `id` is a random uuid and `created_at` is transaction-start time, so neither
-- orders entries within a transaction — a chain needs a monotonic sequence
-- added alongside it.
-- ─────────────────────────────────────────────────────────────────────────────

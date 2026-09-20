-- Invitations: how a new user gets their first password.
--
-- An administrator creates the user; the user sets their own password through
-- a link. The link carries a token, and this table records the token's
-- lifetime — issued, accepted, revoked, expired — without ever holding the
-- token itself.
--
-- ── Only the hash is stored ──────────────────────────────────────────────────
--
-- The same reasoning as sessions.token_hash, and it applies with more force
-- here: an invitation token is the power to choose a person's password, so a
-- raw one in a backup, a replica, or a query log is the power to become that
-- person. The stored SHA-256 verifies a token someone presents and cannot
-- produce one. The token is 256 random bits, so a fast hash is the right one —
-- there is nothing to brute-force and no work factor to buy.
--
-- ── One row per issue ────────────────────────────────────────────────────────
--
-- Resending is a new row, and the earlier pending rows are marked revoked
-- rather than updated in place or deleted. A user who says "I never got it"
-- three times has four rows, and the trail shows each link that was ever able
-- to set their password and what became of it. No DELETE, as for every table
-- whose rows are history.
--
-- ── Tenant-owned ─────────────────────────────────────────────────────────────
--
-- firm_id, composite foreign keys, RLS enabled and forced, fail-closed policies.
-- The acceptance route is public — the person accepting has no session yet —
-- but it still runs under a tenant context resolved from the Host header, so a
-- token issued by one firm is invisible on another firm's subdomain.

CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invitations_token_hash_key" UNIQUE("token_hash"),
	-- An invitation ends one way or not at all.
	CONSTRAINT "invitations_one_outcome_check"
		CHECK ("accepted_at" IS NULL OR "revoked_at" IS NULL)
);--> statement-breakpoint

ALTER TABLE "invitations" ADD CONSTRAINT "invitations_firm_id_user_id_users_firm_id_id_fk"
	FOREIGN KEY ("firm_id","user_id") REFERENCES "public"."users"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "invitations" ADD CONSTRAINT "invitations_firm_id_invited_by_users_firm_id_id_fk"
	FOREIGN KEY ("firm_id","invited_by_user_id") REFERENCES "public"."users"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- The latest invitation per user, for the users screen.
CREATE INDEX "invitations_firm_id_user_id_created_at_idx"
	ON "invitations" USING btree ("firm_id","user_id","created_at" DESC);--> statement-breakpoint

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "invitations_tenant_select" ON "invitations"
  FOR SELECT
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "invitations_tenant_insert" ON "invitations"
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "invitations_tenant_update" ON "invitations"
  FOR UPDATE
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id)
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

-- No DELETE: an invitation is accepted, revoked, or left to expire.
GRANT SELECT, INSERT, UPDATE ON TABLE "invitations" TO legal_app;

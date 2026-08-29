-- Authentication tables: credentials and sessions.
--
-- Both are tenant-owned, so both carry firm_id and both get the same treatment
-- as users: composite foreign keys, row-level security enabled and forced,
-- fail-closed policies for SELECT/INSERT/UPDATE, and no DELETE anywhere.
--
-- The foreign keys reference users (firm_id, id) rather than users (id). A
-- single-column reference would let a row in firm A point at a user in firm B —
-- the database would accept it, and only application code would stand between
-- that and a cross-tenant authentication. Referencing the pair makes the
-- mistake unrepresentable: the (firm_id, user_id) tuple must already exist
-- together in users, which is what the UNIQUE (firm_id, id) constraint on users
-- exists to support.

CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"password_hash" text NOT NULL,
	"password_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_user_id_key" UNIQUE("user_id")
);--> statement-breakpoint

CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_key" UNIQUE("token_hash")
);--> statement-breakpoint

ALTER TABLE "credentials" ADD CONSTRAINT "credentials_firm_id_user_id_users_firm_id_id_fk"
	FOREIGN KEY ("firm_id","user_id") REFERENCES "public"."users"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_firm_id_user_id_users_firm_id_id_fk"
	FOREIGN KEY ("firm_id","user_id") REFERENCES "public"."users"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Revoking every session for a user, and listing a user's own sessions.
CREATE INDEX "sessions_firm_id_user_id_idx" ON "sessions" USING btree ("firm_id","user_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security
--
-- Identical in shape to the users policies as they stand after 0002. Once RLS
-- is enabled the table is deny-by-default, so the absent DELETE policy is the
-- denial: neither a credential nor a session can be destroyed, only superseded
-- or revoked. FORCE extends that to the table owner, so the migrating role is
-- not a standing exception.
--
-- nullif(current_setting('app.current_firm_id', true), '') is NULL both when the
-- setting is absent and when it is blank, and NULL = firm_id is NULL rather than
-- TRUE. A connection with no tenant context reads these tables as empty and can
-- write nothing — including, notably, that it cannot look up a session at all,
-- so a request that skipped withTenant() cannot authenticate anyone.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "credentials_tenant_select" ON "credentials"
  FOR SELECT
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "credentials_tenant_insert" ON "credentials"
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "credentials_tenant_update" ON "credentials"
  FOR UPDATE
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id)
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "sessions_tenant_select" ON "sessions"
  FOR SELECT
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "sessions_tenant_insert" ON "sessions"
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "sessions_tenant_update" ON "sessions"
  FOR UPDATE
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id)
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

-- No DELETE, matching the absent DELETE policies and the rule that nothing is
-- destroyed. A password is superseded; a session is revoked.
GRANT SELECT, INSERT, UPDATE ON TABLE "credentials" TO legal_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "sessions" TO legal_app;

-- Roles and permissions (docs/decisions/0004-permissions.md).
--
-- One global catalogue and three tenant-owned tables. The catalogue is the
-- platform's vocabulary — firms compose roles from it and never extend it —
-- which is why `permissions` carries no firm_id and is readable but not
-- writable by the application.
--
-- The composite foreign keys are the point of the shape. A grant references
-- `roles (firm_id, id)` rather than `roles (id)`, so a role in firm A cannot be
-- assigned to a user in firm B: the pair has to exist together in the parent,
-- which makes the cross-firm grant unrepresentable rather than merely rejected
-- by a check someone remembered to write.

CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"description" text NOT NULL
);--> statement-breakpoint

CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	-- The anchor for every composite reference to a role.
	CONSTRAINT "roles_firm_id_id_key" UNIQUE("firm_id","id"),
	-- Names are unique within a firm, not across the platform. Two firms may
	-- both have a role called "شريك".
	CONSTRAINT "roles_firm_id_name_key" UNIQUE("firm_id","name")
);--> statement-breakpoint

CREATE TABLE "role_permissions" (
	"firm_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_pkey" PRIMARY KEY("firm_id","role_id","permission_key")
);--> statement-breakpoint

CREATE TABLE "user_roles" (
	"firm_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_pkey" PRIMARY KEY("firm_id","user_id","role_id")
);--> statement-breakpoint

ALTER TABLE "roles" ADD CONSTRAINT "roles_firm_id_firms_id_fk"
	FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_firm_id_role_id_roles_firm_id_id_fk"
	FOREIGN KEY ("firm_id","role_id") REFERENCES "public"."roles"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk"
	FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_firm_id_user_id_users_firm_id_id_fk"
	FOREIGN KEY ("firm_id","user_id") REFERENCES "public"."users"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_firm_id_role_id_roles_firm_id_id_fk"
	FOREIGN KEY ("firm_id","role_id") REFERENCES "public"."roles"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- "Who holds this role" — needed to answer whether a firm still has an
-- administrator, which is the check the trigger in a later migration will make.
CREATE INDEX "user_roles_firm_id_role_id_idx" ON "user_roles" USING btree ("firm_id","role_id");--> statement-breakpoint

-- "Which roles carry this permission" — the other half of that question, and of
-- every effective-permission lookup on a request.
CREATE INDEX "role_permissions_firm_id_permission_key_idx" ON "role_permissions" USING btree ("firm_id","permission_key");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The catalogue
--
-- Global reference data: identical for every firm, and the application only
-- ever reads it. Adding a permission is a migration, which is the intended
-- friction — a new permission is a new thing the product can express, and it
-- has to be granted deliberately before anyone holds it.
--
-- No row-level security: there is no tenant dimension to scope by, and the
-- absence of an INSERT/UPDATE grant is what makes it read-only.
--
-- Descriptions are English because this table is engineering-facing. The Arabic
-- labels a firm administrator reads while composing a role are interface text
-- and are not designed yet.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "permissions" ("key", "resource", "action", "description") VALUES
	('firms.view',   'firms', 'view',   'View the firm profile and settings'),
	('firms.manage', 'firms', 'manage', 'Change the firm profile and settings'),
	('users.view',   'users', 'view',   'View the firm user directory'),
	('users.manage', 'users', 'manage', 'Invite, edit and disable users'),
	('roles.view',   'roles', 'view',   'View roles and their permissions'),
	('roles.manage', 'roles', 'manage', 'Create, edit and archive roles, and assign them to users')
ON CONFLICT ("key") DO UPDATE SET
	"resource" = EXCLUDED."resource",
	"action" = EXCLUDED."action",
	"description" = EXCLUDED."description";--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security
--
-- Same shape as every other tenant table: enabled and forced, fail-closed on an
-- absent or blank tenant setting.
--
-- Deletion differs here, and the distinction is deliberate. The no-delete rule
-- exists to protect legal records — cases, documents, audit entries — where the
-- record itself is the artefact and destroying it destroys history.
--
-- `role_permissions` and `user_roles` are configuration, not records. Editing a
-- role means removing a permission from it; taking a role away from someone
-- means removing the assignment. Without DELETE, a role's composition would be
-- append-only and an assignment permanent, which is not a safety property but a
-- missing feature.
--
-- What must survive is the *history* of those changes, and that lives in the
-- audit log, not in the join row. Keeping a revoked grant as a tombstone would
-- put the record in the worst place: every effective-permission query would need
-- to exclude it, and forgetting that filter once grants access that was revoked.
-- A row that is gone cannot be read by mistake.
--
-- `roles` itself keeps no DELETE. A role that ever appeared in the audit trail
-- must still be nameable, so it is retired with `archived_at`.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "roles_tenant_select" ON "roles"
  FOR SELECT
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "roles_tenant_insert" ON "roles"
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "roles_tenant_update" ON "roles"
  FOR UPDATE
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id)
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "role_permissions_tenant_select" ON "role_permissions"
  FOR SELECT
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "role_permissions_tenant_insert" ON "role_permissions"
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "role_permissions_tenant_update" ON "role_permissions"
  FOR UPDATE
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id)
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

-- DELETE takes USING only: it selects which rows may be removed, and there is no
-- resulting row to check. Still tenant-scoped, so a caller cannot strip another
-- firm's role of its permissions.
CREATE POLICY "role_permissions_tenant_delete" ON "role_permissions"
  FOR DELETE
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "user_roles_tenant_select" ON "user_roles"
  FOR SELECT
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "user_roles_tenant_insert" ON "user_roles"
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "user_roles_tenant_update" ON "user_roles"
  FOR UPDATE
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id)
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "user_roles_tenant_delete" ON "user_roles"
  FOR DELETE
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

-- Read-only catalogue.
GRANT SELECT ON TABLE "permissions" TO legal_app;--> statement-breakpoint

-- Archived, never deleted: a role named in the audit trail must stay nameable.
GRANT SELECT, INSERT, UPDATE ON TABLE "roles" TO legal_app;--> statement-breakpoint

-- Configuration, so DELETE is granted. Revocation is made auditable by the audit
-- log rather than by keeping the join row.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "role_permissions" TO legal_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "user_roles" TO legal_app;

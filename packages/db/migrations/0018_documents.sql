-- Documents: the files a matter is made of.
--
-- Two tables, because a document and its file are different things with
-- different lifetimes. `documents` is the entry in the file — "the statement
-- of claim", with a title a lawyer chose — and it persists across every
-- revision. `document_versions` is one upload of bytes against that entry.
-- A corrected contract is a new version of the same document, not a new
-- document, and the earlier version stays: what was filed on the 3rd is part
-- of the record even after a better draft exists.
--
-- ── What the database knows about the bytes ──────────────────────────────────
--
-- `storage_key` is opaque. It is whatever the storage implementation returned
-- when the file was written, and the database neither parses it nor builds a
-- path from it. Where the bytes live — local disk in development, something
-- in-Kingdom later — is a property of the deployment, not of the row, and a
-- column that encoded it would have to be migrated every time that changes.
--
-- `checksum` is what makes the bytes accountable. It is computed by the API
-- from what was received, before anything is stored, and the download route
-- recomputes it from what storage hands back. A file altered at rest therefore
-- fails to download rather than being served as the original — the integrity
-- property docs/threat-model.md promises an opposing party cannot argue away.
-- The algorithm is part of the value (`sha256:<hex>`), so a later change of
-- algorithm does not make the existing values ambiguous.
--
-- `content_type` is the type the API *detected* from the file's content, never
-- the one the uploader's browser declared. See apps/api/src/documents/
-- file-type.ts for how, and for why the declared type and the extension are
-- checked but not believed.
--
-- ── No current-version pointer ───────────────────────────────────────────────
--
-- The current version is the highest `version_number`. A pointer column on
-- `documents` would be a second answer to that question which every upload
-- would have to keep in step, and the unique key below already makes "the
-- highest" a cheap index lookup.

CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"title_ar" text NOT NULL,
	"title" text,
	"description" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,

	CONSTRAINT "documents_firm_id_id_key" UNIQUE("firm_id","id"),

	-- An empty Arabic title is a document nobody can find in a list. The API
	-- trims and requires it; this is the floor beneath that.
	CONSTRAINT "documents_title_ar_not_blank" CHECK (btrim("title_ar") <> '')
);--> statement-breakpoint

ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_id_firms_id_fk"
	FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_id_case_id_cases_firm_id_id_fk"
	FOREIGN KEY ("firm_id","case_id") REFERENCES "public"."cases"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_id_created_by_user_id_users_firm_id_id_fk"
	FOREIGN KEY ("firm_id","created_by_user_id") REFERENCES "public"."users"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- "The documents on this matter" — the case screen's section.
CREATE INDEX "documents_firm_id_case_id_created_at_idx"
	ON "documents" USING btree ("firm_id","case_id","created_at");--> statement-breakpoint

CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	-- As uploaded, after the API has removed path separators, control
	-- characters and bidirectional overrides. Shown to people and offered as
	-- the download name; never used to locate the bytes.
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"checksum" text NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,

	-- Lets a later table — an AI citation, a filing record — point at one
	-- exact version with a composite key, the same way everything else here
	-- references its parent. Grounded answers have to cite the bytes they were
	-- grounded in, not whichever version is current when someone reads them.
	CONSTRAINT "document_versions_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "document_versions_firm_id_document_id_version_number_key"
		UNIQUE("firm_id","document_id","version_number"),

	CONSTRAINT "document_versions_version_number_check" CHECK ("version_number" >= 1),
	-- An empty upload is refused by the API; a zero-byte version would be a
	-- record of nothing.
	CONSTRAINT "document_versions_size_bytes_check" CHECK ("size_bytes" > 0),
	CONSTRAINT "document_versions_checksum_check"
		CHECK ("checksum" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "document_versions_file_name_not_blank" CHECK (btrim("file_name") <> ''),
	CONSTRAINT "document_versions_storage_key_not_blank" CHECK ("storage_key" <> '')
);--> statement-breakpoint

ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_firm_id_firms_id_fk"
	FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_firm_id_document_id_documents_firm_id_id_fk"
	FOREIGN KEY ("firm_id","document_id") REFERENCES "public"."documents"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_firm_id_uploaded_by_user_id_users_firm_id_id_fk"
	FOREIGN KEY ("firm_id","uploaded_by_user_id") REFERENCES "public"."users"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- No further index: the (firm_id, document_id, version_number) unique key
-- serves both "this document's versions, in order" and "the latest one".

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security
--
-- The established fail-closed form, on both tables. No DELETE policy and no
-- DELETE grant on either: a document is the clearest case in this schema of a
-- record that is itself the artefact. `archived_at` removes a document from
-- active views; a version is never removed at all, only followed by another.
--
-- `document_versions` has no UPDATE grant either. Nothing about an uploaded
-- version is editable — a different file is a new version, and a corrected
-- file name on an old one would make the download name disagree with what was
-- recorded at the time. The UPDATE policy exists anyway so that the table has
-- the same shape as every other: if a grant is ever added, the tenant
-- boundary is already in place rather than missing.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "documents_tenant_select" ON "documents"
  FOR SELECT
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "documents_tenant_insert" ON "documents"
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

-- Both USING and WITH CHECK. USING alone would let a caller move a row out of
-- their firm: the row is visible to update, and nothing would test what
-- firm_id becomes afterwards.
CREATE POLICY "documents_tenant_update" ON "documents"
  FOR UPDATE
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id)
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

-- UPDATE is also what `SELECT … FOR UPDATE` needs: a new version locks its
-- document row so two simultaneous uploads cannot both claim the next number.
GRANT SELECT, INSERT, UPDATE ON TABLE "documents" TO legal_app;--> statement-breakpoint

ALTER TABLE "document_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "document_versions_tenant_select" ON "document_versions"
  FOR SELECT
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "document_versions_tenant_insert" ON "document_versions"
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "document_versions_tenant_update" ON "document_versions"
  FOR UPDATE
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id)
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

-- Append-only: SELECT and INSERT, nothing else.
GRANT SELECT, INSERT ON TABLE "document_versions" TO legal_app;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Catalogue additions
--
-- Four permissions, and the split between the first and third is the reason
-- the catalogue exists. `documents.view` is knowing what is in the file — the
-- titles, the versions, who uploaded what and when. `documents.download` is
-- taking the bytes out of the building. A trainee who files and organises a
-- matter needs the first and not the second, and the departing employee in
-- docs/threat-model.md is answered by the gap between them (0004).
--
-- `documents.upload` covers both a new document and a new version of one:
-- each puts a file into the record, and someone trusted to add the statement
-- of claim is the same person trusted to add its corrected draft.
-- `documents.manage` is archiving, and whatever later edits a document's
-- details; it is separate from upload because taking something out of the
-- active file is a different act from putting something in.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "permission_resources" ("resource", "label_ar", "sort_order") VALUES
	('documents', 'المستندات', 37)
ON CONFLICT ("resource") DO UPDATE SET
	"label_ar" = EXCLUDED."label_ar",
	"sort_order" = EXCLUDED."sort_order";--> statement-breakpoint

INSERT INTO "permissions" ("key", "resource", "action", "description", "label_ar") VALUES
	('documents.view',     'documents', 'view',     'See which documents and versions exist on the firm''s cases', 'عرض المستندات'),
	('documents.upload',   'documents', 'upload',   'Upload a new document or a new version of one', 'رفع المستندات'),
	('documents.download', 'documents', 'download', 'Download the content of a document version', 'تنزيل المستندات'),
	('documents.manage',   'documents', 'manage',   'Archive documents', 'إدارة المستندات')
ON CONFLICT ("key") DO UPDATE SET
	"resource" = EXCLUDED."resource",
	"action" = EXCLUDED."action",
	"description" = EXCLUDED."description",
	"label_ar" = EXCLUDED."label_ar";

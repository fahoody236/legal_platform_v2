-- Hearings: the court dates a matter turns on.
--
-- A hearing belongs to a case, never to a firm alone — `case_id` is NOT NULL
-- for the same reason a task's is. A court date with no matter is a diary
-- entry, and the moment one exists someone has to decide which client it
-- concerns and what happens to it when the case closes.
--
-- ── No attendee column ───────────────────────────────────────────────────────
--
-- A hearing is not assigned to anyone. The lawyer the case is assigned to
-- attends it; that fact lives on `cases.assigned_lawyer_id` and must have one
-- home, not two. A per-hearing attendee would be a second answer to "who is
-- carrying this matter" that nothing keeps in step with the first, and the
-- first is the one the rest of the product already reads.
--
-- ── Adjournment is two rows, and that is the API's job ───────────────────────
--
-- Adjourning means this hearing becomes 'adjourned' and a new one is created;
-- the old row is never edited into the new date, because when the court sat
-- and did not proceed is itself part of the file.
--
-- That pairing is NOT enforced here, deliberately. It is cross-row, so a CHECK
-- cannot express it; it would need a self-reference and a deferred constraint
-- trigger like 0015's. The reason not to build one is that it would be wrong:
-- courts adjourn without setting a date — إلى أجل غير مسمى, or the clerk
-- notifies the new date later — so a trigger demanding a successor at commit
-- would refuse to record a true fact, and the workaround would be a
-- placeholder hearing with an invented date. The database keeps what is always
-- true; POST /hearings/:id/adjourn writes both rows in one transaction, and
-- the ordinary status route refuses 'adjourned' so the pairing cannot be
-- sidestepped by accident.
--
-- ── Notes ────────────────────────────────────────────────────────────────────
--
-- `notes` records what happened, so it is only meaningful once the hearing
-- has. There is no constraint tying it to status, and that is considered: one
-- would block the correction path — a hearing marked held with notes, then set
-- back to scheduled because someone clicked the wrong row — which is the same
-- trap the tasks completion constraint sets and the reason task completion had
-- to become its own route. The form shapes this instead; see the API.

CREATE TABLE "hearings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	-- Nullable, and defaulted in the interface from the case's own court. Most
	-- hearings sit in the court the matter is filed in, and repeating it on
	-- every row is how the two come to disagree. Null means "the case's court";
	-- a value means this hearing is somewhere else, which happens on referral
	-- and on appeal.
	"court" text,
	-- الدائرة — the circuit or chamber within the court.
	"circuit" text,
	"hearing_type" text NOT NULL,
	"status" text NOT NULL,
	-- What happened, recorded after. Null while the hearing is still ahead.
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,

	CONSTRAINT "hearings_firm_id_id_key" UNIQUE("firm_id","id"),

	-- CHECK rather than an enum, as for case status (0010) and task status
	-- (0012): an enum value cannot be dropped or renamed without rewriting the
	-- type, and both lists here are court practice rather than platform
	-- vocabulary.
	CONSTRAINT "hearings_hearing_type_check"
		CHECK ("hearing_type" IN ('pleading', 'judgment', 'appeal', 'expert', 'other')),
	CONSTRAINT "hearings_status_check"
		CHECK ("status" IN ('scheduled', 'held', 'adjourned', 'cancelled'))
);--> statement-breakpoint

ALTER TABLE "hearings" ADD CONSTRAINT "hearings_firm_id_firms_id_fk"
	FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "hearings" ADD CONSTRAINT "hearings_firm_id_case_id_cases_firm_id_id_fk"
	FOREIGN KEY ("firm_id","case_id") REFERENCES "public"."cases"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "hearings" ADD CONSTRAINT "hearings_firm_id_created_by_user_id_users_firm_id_id_fk"
	FOREIGN KEY ("firm_id","created_by_user_id") REFERENCES "public"."users"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- "The hearings on this matter, in order" — the case screen's section.
CREATE INDEX "hearings_firm_id_case_id_scheduled_at_idx"
	ON "hearings" USING btree ("firm_id","case_id","scheduled_at");--> statement-breakpoint

-- "What is coming up" — the dashboard. Partial, because the question is only
-- ever asked of hearings that have not happened yet: a held or cancelled one
-- can sit in the future for a while without being upcoming, and indexing the
-- whole history would put most of the table into an index that never matches.
CREATE INDEX "hearings_firm_id_scheduled_at_upcoming_idx"
	ON "hearings" USING btree ("firm_id","scheduled_at")
	WHERE "status" = 'scheduled' AND "archived_at" IS NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security
--
-- The established fail-closed form. No DELETE policy and no DELETE grant: that
-- a court date was set, and then adjourned or cancelled, is the history of the
-- matter. `cancelled` is the lifecycle verb, `archived_at` removes a row from
-- active views, and neither destroys anything.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "hearings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hearings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "hearings_tenant_select" ON "hearings"
  FOR SELECT
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "hearings_tenant_insert" ON "hearings"
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

-- Both USING and WITH CHECK. USING alone would let a caller move a row out of
-- their firm: the row is visible to update, and nothing would test what
-- firm_id becomes afterwards.
CREATE POLICY "hearings_tenant_update" ON "hearings"
  FOR UPDATE
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id)
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON TABLE "hearings" TO legal_app;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Catalogue additions
--
-- Two permissions, not four. Cases and tasks split create/edit/assign because
-- a firm plausibly withholds one from someone who has the others; a hearing
-- has no assignment to withhold, and someone trusted to enter a court date is
-- the same person trusted to record that it was adjourned. `hearings.manage`
-- covers create, edit, status and adjournment.
--
-- The resource row comes first: `permissions.resource` references it (0014),
-- and its label is what the role editor shows as a group heading.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "permission_resources" ("resource", "label_ar", "sort_order") VALUES
	('hearings', 'الجلسات', 35)
ON CONFLICT ("resource") DO UPDATE SET
	"label_ar" = EXCLUDED."label_ar",
	"sort_order" = EXCLUDED."sort_order";--> statement-breakpoint

INSERT INTO "permissions" ("key", "resource", "action", "description", "label_ar") VALUES
	('hearings.view',   'hearings', 'view',   'View hearings on the firm''s cases', 'عرض الجلسات'),
	('hearings.manage', 'hearings', 'manage', 'Schedule, edit, adjourn and record hearings', 'إدارة الجلسات')
ON CONFLICT ("key") DO UPDATE SET
	"resource" = EXCLUDED."resource",
	"action" = EXCLUDED."action",
	"description" = EXCLUDED."description",
	"label_ar" = EXCLUDED."label_ar";

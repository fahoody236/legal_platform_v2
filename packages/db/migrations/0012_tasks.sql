-- Tasks: the work a matter is broken into.
--
-- A task belongs to a case, never to a firm alone. There is no `case_id IS
-- NULL` here and none should be added: a task with no matter is a note, and the
-- moment one exists someone has to decide which screens show it, which client
-- it is billable to, and what happens to it when a case closes. Those are
-- product questions, and leaving the column nullable answers them by accident.
--
-- Four composite foreign keys, all carrying `firm_id`: the case, the assignee,
-- and the creator. A task cannot name another firm's case or another firm's
-- person, because the pair does not exist in the parent.

CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	-- Arabic is the required title, as on clients and cases since 0011.
	"title_ar" text NOT NULL,
	"title" text,
	"description" text,
	-- Null while unassigned, which is a real state: a task can exist on a matter
	-- before anyone has picked it up, and a firm needs to be able to list those.
	"assigned_to_user_id" uuid,
	"status" text NOT NULL,
	"priority" text NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	-- Required. Who added the task is part of what the record means, and unlike
	-- the assignee there is never a moment when it is unknown.
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,

	CONSTRAINT "tasks_firm_id_id_key" UNIQUE("firm_id","id"),

	-- CHECK rather than an enum, for the reasons migration 0010 sets out at
	-- length for case status: an enum value cannot be dropped or renamed, only
	-- escaped by rewriting the type, and both of these lists are firm workflow.
	CONSTRAINT "tasks_status_check" CHECK ("status" IN ('open', 'in_progress', 'done', 'cancelled')),
	CONSTRAINT "tasks_priority_check" CHECK ("priority" IN ('low', 'normal', 'high')),

	-- ── The one constraint that makes completion an action ───────────────────
	--
	-- `status = 'done'` and `completed_at` must agree, in both directions. An
	-- equality between two booleans is the whole rule: done implies a timestamp,
	-- a timestamp implies done, and neither can drift from the other.
	--
	-- Without it, the two ways to get this wrong are both silent. A generic
	-- status edit to 'done' leaves `completed_at` null, so "when was this
	-- finished" has no answer and every report that measures turnaround skips
	-- the row. Moving a task back off 'done' without clearing the timestamp
	-- leaves an open task carrying a completion time, which nothing downstream
	-- would ever flag as impossible.
	--
	-- This is why the API exposes `POST /tasks/:id/complete` and refuses
	-- `status: "done"` on the generic update: not because the endpoint is
	-- prettier, but because the pair has to be written together and a field on
	-- an edit form cannot express that.
	CONSTRAINT "tasks_completed_at_matches_status_check"
		CHECK (("status" = 'done') = ("completed_at" IS NOT NULL))
);--> statement-breakpoint

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_firm_id_firms_id_fk"
	FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_firm_id_case_id_cases_firm_id_id_fk"
	FOREIGN KEY ("firm_id","case_id") REFERENCES "public"."cases"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- MATCH SIMPLE, so an unassigned task skips the check entirely — which is what
-- lets the column be nullable without weakening the assigned case.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_firm_id_assigned_to_user_id_users_firm_id_id_fk"
	FOREIGN KEY ("firm_id","assigned_to_user_id") REFERENCES "public"."users"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_firm_id_created_by_user_id_users_firm_id_id_fk"
	FOREIGN KEY ("firm_id","created_by_user_id") REFERENCES "public"."users"("firm_id","id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- "The tasks on this matter" — the case screen, and the check before closing a
-- case.
CREATE INDEX "tasks_firm_id_case_id_idx" ON "tasks" USING btree ("firm_id","case_id");--> statement-breakpoint

-- "My tasks" — the first screen most people will open. Status is in the key
-- because that list is almost always filtered to the unfinished ones.
CREATE INDEX "tasks_firm_id_assigned_to_user_id_status_idx" ON "tasks" USING btree ("firm_id","assigned_to_user_id","status");--> statement-breakpoint

-- "What is overdue" — a partial index, because the question is only ever asked
-- of live work. Finished and cancelled tasks can be past their date without
-- being late, and indexing them would put most of the table's history into an
-- index that never matches it.
CREATE INDEX "tasks_firm_id_due_at_open_idx" ON "tasks" USING btree ("firm_id","due_at")
	WHERE "status" IN ('open', 'in_progress') AND "archived_at" IS NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security
--
-- The established fail-closed form. No DELETE policy and no DELETE grant: a
-- task records that work was asked for, and a cancelled task is part of a
-- matter's history in the way a deleted one would not be. `cancelled` is the
-- lifecycle verb here, `archived_at` removes it from active views, and neither
-- destroys anything.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "tasks_tenant_select" ON "tasks"
  FOR SELECT
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "tasks_tenant_insert" ON "tasks"
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

-- Both USING and WITH CHECK. USING alone would let a caller move a row out of
-- their firm: the row is visible to update, and nothing would test what firm_id
-- becomes afterwards.
CREATE POLICY "tasks_tenant_update" ON "tasks"
  FOR UPDATE
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id)
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON TABLE "tasks" TO legal_app;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Catalogue additions
--
-- `tasks.assign` is split from `tasks.edit` for the same reason `cases.assign`
-- is split from `cases.edit`: assignment allocates someone's time and reveals
-- who is working on what, and a firm is likelier to want that held narrowly
-- than the ability to correct a title.
--
-- There is deliberately no `tasks.complete`. Marking your own work finished is
-- not a privilege a firm withholds from the people it asked to do the work —
-- and if it were withheld, the task would sit open forever while the person who
-- finished it had no way to say so. It rides with `tasks.edit`.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "permissions" ("key", "resource", "action", "description") VALUES
	('tasks.view',   'tasks', 'view',   'View tasks on the firm''s cases'),
	('tasks.create', 'tasks', 'create', 'Add tasks to a case'),
	('tasks.edit',   'tasks', 'edit',   'Edit tasks, and mark them complete or cancelled'),
	('tasks.assign', 'tasks', 'assign', 'Assign and reassign the person responsible for a task')
ON CONFLICT ("key") DO UPDATE SET
	"resource" = EXCLUDED."resource",
	"action" = EXCLUDED."action",
	"description" = EXCLUDED."description";

-- The client model: Arabic-first names, and clients that may be companies.
--
-- Two changes to `clients`, both correcting 0010 before it carries any data.
-- The first is about which name the database insists on. The second is that
-- 0010 modelled only natural persons, which is not what a law firm's client
-- list looks like.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Part 1 — Arabic is the required name, Latin is the optional one
--
-- 0010 had this backwards. It made `name` and `title` NOT NULL and left the
-- Arabic columns nullable, following the shape of `users`, which was itself
-- written before the requirement was thought through. For a platform whose
-- clients are Saudi firms acting for predominantly Arabic-named clients, that
-- makes the Latin transliteration the field the database insists on and the
-- Arabic name — the one every user actually reads — the afterthought.
--
-- The practical consequence is worse than the symbolic one. A required Latin
-- name for a client who has none does not stay empty: someone types a
-- transliteration to get past the constraint. Transliteration has no single
-- correct form, so the invented value is one nobody else will search for and
-- nobody will think to correct, and it becomes the label on screens and
-- invoices. Requiring the name that exists produces a record that is right;
-- requiring the one that may not produces a record that is confidently wrong.
--
-- The reverse case — a foreign corporate client with no Arabic name — is what
-- `name` stays nullable for. It is the genuine exception, and it is now
-- represented as an absence rather than as a fabrication.
--
-- ── No backfill, deliberately ────────────────────────────────────────────────
--
-- SET NOT NULL fails if any row holds a NULL, and there is no UPDATE here to
-- prevent that. Both tables are empty (verified before writing this), so the
-- question is what should happen if they were not: the answer is that this
-- migration should fail. `name_ar = name` would write a Latin string into the
-- Arabic column, which is exactly the fabrication the change exists to stop,
-- and it would do it silently and permanently across every existing row. If
-- this ever fails on a populated table, the fix is for someone to supply the
-- Arabic names, not for the migration to invent them.
--
-- Note for whoever does that: `clients` and `cases` are under FORCE ROW LEVEL
-- SECURITY with no context-free UPDATE policy, so a backfill needs
-- `NO FORCE ROW LEVEL SECURITY` around it, as migration 0006 does for firms.

ALTER TABLE "clients" ALTER COLUMN "name_ar" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "cases" ALTER COLUMN "title_ar" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "title" DROP NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- One client record per national ID, per firm
--
-- Two records for one person is not a tidiness problem. It splits that person's
-- matters across two client rows, so the client page shows half the history and
-- a conflict check run against one of them comes back clean when it should not.
--
-- Per firm, not global. Two firms acting for the same person hold two records
-- by design — a shared client row would be a cross-tenant object, making the
-- existence of the relationship visible across the boundary. Scoping the
-- constraint by firm is what keeps this from leaking that.
--
-- On the WHERE clause: it is not what permits many clients without a national
-- ID. A plain unique index would already allow those, because NULL is never
-- equal to NULL in PostgreSQL. The predicate earns its place by keeping the
-- rows that can never match out of the index — for a firm whose clients are
-- mostly companies, that is most of the table.
--
-- Known limit: this compares the stored text exactly, so '1234567890' and
-- '1234567890 ' are two different clients as far as the index is concerned.
-- Normalising the value on the way in belongs in the application, and is not
-- done yet.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX "clients_firm_id_national_id_key" ON "clients"
  USING btree ("firm_id","national_id")
  WHERE "national_id" IS NOT NULL;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- Part 2 — a client is a person or a company
--
-- 0010 gave every client a `national_id` and nothing else, which models a
-- natural person. Most of a Saudi firm's client list is not natural persons,
-- and a company is not a person with a different identifier: it has a
-- commercial registration instead of a national ID, may have a VAT number, and
-- acts through named people who are not themselves the client.
--
-- The identifier is the part worth getting into the database rather than the
-- application. It is the value a conflict check runs against and the value the
-- partial unique indexes deduplicate on, so a client carrying the wrong kind of
-- identifier — or both, or neither — is not a validation slip, it is a client
-- that silently fails to deduplicate and silently passes a conflict check.
--
-- Note that this supersedes a comment in 0010, which said `national_id` was
-- nullable partly because "a new matter often opens before the number is to
-- hand". That is no longer true for individuals: the identifier is now required
-- at the point the client record is created. 0010 is applied and immutable, so
-- the comment stands there uncorrected; this is the correction.

ALTER TABLE "clients" ADD COLUMN "client_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "commercial_registration" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "vat_number" text;--> statement-breakpoint

-- No DEFAULT on client_type, and the table is empty, so this is safe. A default
-- would be the wrong tool even if it were not: 'individual' would quietly
-- classify every existing company as a person, and the resulting rows would
-- then fail the identifier check below rather than being silently wrong — which
-- is better, but still a migration that decides something a human should.

ALTER TABLE "clients" ADD CONSTRAINT "clients_client_type_check"
  CHECK ("client_type" IN ('individual', 'company'));--> statement-breakpoint

-- The identifier rule, as one constraint per readable failure.
--
-- Written as an exclusive either/or rather than as two independent "if type
-- then column" rules, because the failure worth blocking is a row that carries
-- *both* identifiers. That row looks complete on screen and deduplicates
-- against two different indexes, so nothing downstream would notice it.
ALTER TABLE "clients" ADD CONSTRAINT "clients_identifier_by_type_check" CHECK (
  ("client_type" = 'individual'
     AND "national_id" IS NOT NULL
     AND "commercial_registration" IS NULL)
  OR
  ("client_type" = 'company'
     AND "commercial_registration" IS NOT NULL
     AND "national_id" IS NULL)
);--> statement-breakpoint

-- VAT registration is a property of a business, so an individual holding one is
-- a data-entry error. Optional for companies: registration is only mandatory
-- above a turnover threshold, so a small company legitimately has none, and
-- requiring it would push someone to invent a number to save the record.
ALTER TABLE "clients" ADD CONSTRAINT "clients_vat_number_company_only_check"
  CHECK ("client_type" = 'company' OR "vat_number" IS NULL);--> statement-breakpoint

-- ── Identifier formats ──────────────────────────────────────────────────────
--
-- Each of these numbers has one correct written form, and pinning it does two
-- separate jobs.
--
-- The obvious one is catching a typo at the point of entry — a transposed or
-- dropped digit produces a value that is wrong but plausible, and a conflict
-- check run against a wrong identifier comes back clean.
--
-- The one worth more is that it makes the partial unique indexes above actually
-- deduplicate. Without a format rule, '1234567890' and '1234567890 ' are two
-- different keys, so the same person can be entered twice and the index will
-- not object. These patterns are anchored and digits-only, so a given number has
-- exactly one storable spelling — which is what a uniqueness constraint has to
-- assume to mean anything. It also closes the whitespace gap noted in Part 1.
--
-- A CHECK that evaluates to NULL passes, so each of these permits a NULL value
-- and constrains only rows that carry one. The "required for this type" rule is
-- the separate constraint above; these say nothing about presence.
--
-- Where these could be wrong: the digit counts and the leading/trailing digits
-- below are the stable, well-documented parts of each format. Anything narrower
-- — encoding the region prefixes a commercial registration used to carry, for
-- instance — would reject legitimate legacy numbers, so it is left out. If one
-- of these ever refuses a real client's real number, the fix is a new migration
-- widening the pattern, not an application-side workaround.

-- National ID or iqama: 10 digits. 1 for a Saudi national, 2 for a resident.
ALTER TABLE "clients" ADD CONSTRAINT "clients_national_id_format_check"
  CHECK ("national_id" ~ '^[12][0-9]{9}$');--> statement-breakpoint

-- Commercial registration: 10 digits. The leading digits vary by issuing region
-- and by era — including the newer 700-series unified number — so only the
-- length is constrained.
ALTER TABLE "clients" ADD CONSTRAINT "clients_commercial_registration_format_check"
  CHECK ("commercial_registration" ~ '^[0-9]{10}$');--> statement-breakpoint

-- VAT registration number: 15 digits, beginning and ending with 3.
ALTER TABLE "clients" ADD CONSTRAINT "clients_vat_number_format_check"
  CHECK ("vat_number" ~ '^3[0-9]{13}3$');--> statement-breakpoint

-- Same treatment as national_id, for the same reason: two records for one
-- company split its matters across both. See Part 1 for why the predicate is
-- about index size rather than about permitting multiple NULLs.
CREATE UNIQUE INDEX "clients_firm_id_commercial_registration_key" ON "clients"
  USING btree ("firm_id","commercial_registration")
  WHERE "commercial_registration" IS NOT NULL;--> statement-breakpoint

-- The anchor that makes the representatives table below possible. Adding
-- client_type to a unique key looks redundant next to clients_firm_id_id_key —
-- (firm_id, id) is already unique, so this constrains nothing new. It is not
-- here to constrain; it is here to be referenced. See the FK below.
ALTER TABLE "clients" ADD CONSTRAINT "clients_firm_id_id_client_type_key"
  UNIQUE("firm_id","id","client_type");--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- Part 3 — representatives
--
-- A company acts through people: a general manager, an authorised signatory, an
-- in-house counsel who instructs the firm. They are not clients — the company
-- is the client — but the firm needs to know who may give instructions, and
-- later, whose signature binds a contract.
--
-- ── "Only companies have representatives": enforced in the database ──────────
--
-- Enforced here, and enforced structurally rather than by a trigger. Three ways
-- to do it, and the difference between them is what happens years from now:
--
--   1. Application code checks the client's type before inserting. This is the
--      rule that erodes. It holds for the endpoint someone wrote it in, and not
--      for the import script, the admin tool, or the second endpoint written by
--      someone who did not know the first one existed.
--
--   2. A trigger on client_representatives looks up the parent's type. It works,
--      and it is invisible: nothing in the table definition says the rule
--      exists, so it is discovered by hitting it. It also needs a second trigger
--      on clients to stop a company with representatives being changed to an
--      individual, and the pair has to be kept consistent by whoever edits
--      either.
--
--   3. Carry client_type on the child, CHECK that it is 'company', and make the
--      foreign key reference (firm_id, id, client_type). Then a representative
--      row can only reference a client whose type is literally 'company',
--      because the triple has to exist in the parent. This is the same trick the
--      whole schema already uses for tenancy: a cross-firm reference is
--      unrepresentable because firm_id is part of the key, and here a
--      representative of an individual is unrepresentable for exactly the same
--      reason.
--
-- Option 3, and it pays a second dividend for free. Changing a client from
-- 'company' to 'individual' while representatives exist would break the
-- referenced triple, so PostgreSQL refuses the UPDATE. The rule is enforced in
-- both directions without a second object to maintain — which is precisely what
-- option 2 has to do by hand.
--
-- The cost is one denormalised column. It cannot drift: the FK requires it to
-- equal the parent's value, so it is a copy the database itself keeps honest.
--
-- Note the FK carries firm_id, so it is the tenant guarantee as well. There is
-- deliberately no second FK on (firm_id, client_id) — it would be implied by
-- this one and would only add a second index to maintain.

CREATE TABLE "client_representatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	-- Always 'company'. Not a fact about this row so much as the mechanism that
	-- ties it to a company client — see the FK below.
	"client_type" text NOT NULL,
	"name_ar" text NOT NULL,
	"name" text,
	-- Nullable, unlike on an individual client. A firm often knows who signs
	-- long before it holds their ID, and the representative is not the client —
	-- the identifier that matters for conflicts is the company's registration.
	"national_id" text,
	-- The reason this person is on the record: what they are authorised to do.
	-- A representative with no stated role is one nobody can act on.
	"role" text NOT NULL,
	-- The same format rule as an individual client's, because it is the same
	-- number. Validating it in one table and not the other would mean the value
	-- a firm holds for a person depends on which screen it was typed into.
	CONSTRAINT "client_representatives_national_id_format_check" CHECK ("national_id" ~ '^[12][0-9]{9}$'),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- Someone who leaves the company is archived, not deleted. A contract signed
	-- by them stays attributable.
	"archived_at" timestamp with time zone,
	CONSTRAINT "client_representatives_client_type_check" CHECK ("client_type" = 'company')
);--> statement-breakpoint

ALTER TABLE "client_representatives" ADD CONSTRAINT "client_representatives_firm_id_firms_id_fk"
	FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- The three-column reference described above: tenant safety and the
-- company-only rule in one constraint.
ALTER TABLE "client_representatives" ADD CONSTRAINT "client_representatives_firm_id_client_id_client_type_clients_fk"
	FOREIGN KEY ("firm_id","client_id","client_type") REFERENCES "public"."clients"("firm_id","id","client_type")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- "Who represents this client" — the only way this table is read.
CREATE INDEX "client_representatives_firm_id_client_id_idx" ON "client_representatives" USING btree ("firm_id","client_id");--> statement-breakpoint

-- No unique index on national_id here, deliberately. One person can represent
-- several companies the firm acts for, and often does — a partner or director
-- with interests in more than one. Deduplicating on it would refuse a true
-- record.

ALTER TABLE "client_representatives" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_representatives" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "client_representatives_tenant_select" ON "client_representatives"
  FOR SELECT
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "client_representatives_tenant_insert" ON "client_representatives"
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

CREATE POLICY "client_representatives_tenant_update" ON "client_representatives"
  FOR UPDATE
  USING (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id)
  WITH CHECK (nullif(current_setting('app.current_firm_id', true), '')::uuid = firm_id);--> statement-breakpoint

-- No DELETE policy and no DELETE grant. A representative who leaves is
-- archived: the contracts they signed stay attributable to a named person.
GRANT SELECT, INSERT, UPDATE ON TABLE "client_representatives" TO legal_app;

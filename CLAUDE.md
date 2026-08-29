# CLAUDE.md

Guidance for Claude Code when working in this repository.

---

## What this project is

A **multi-tenant SaaS platform for Saudi law firms**. Many independent firms
share one deployment; each firm is a tenant.

Three product requirements define the system:

1. **Tenant isolation.** A firm must only ever see its own data. This is the
   central invariant — cases, documents, invoices, contracts, tasks, chat,
   AI drafts, and knowledge-base entries all belong to exactly one firm and
   must never be readable or writable across firm boundaries.
2. **Arabic-first.** Arabic is the primary language and RTL is the primary
   layout direction — not a translation layer added over an English product.
   Legal content, client names, and generated drafts are predominantly Arabic.
3. **Data residency in Saudi Arabia.** Client data is hosted in-Kingdom.
   This constrains database, file-storage, and any third-party processor
   (including AI inference) selection.

The working name in the current code is "Alhumoudi Lawyers", which is a single
firm. That reflects the prototype's origin, not the target product — treat any
hardcoded reference to one firm as something to be removed.

---

## Current state: the code does not do any of the above

**The backend is being rebuilt because of this.** The existing implementation is
a single-firm prototype. Do not treat the current code as a reference for how
the platform should work.

Verified gaps as of this file's writing:

| Requirement | Current state |
|---|---|
| Authentication | **None.** No auth middleware exists; `artifacts/api-server/src/middlewares/` contains only `.gitkeep`. Every one of the ~73 endpoints is public and unauthenticated. |
| Tenant separation | **None.** No `firm_id` / `tenant_id` column exists on any table in `lib/db/src/schema/`. There is no firms/tenants table. Every query reads the whole table. |
| Permissions | **None.** `users.role` (`admin \| lawyer \| support`) exists but is never used as an access gate — only for dashboard counts and filtering lists. |
| Arabic-first / RTL | **Not implemented.** `index.html` is `<html lang="en">`; there is no i18n library, no locale handling, and no RTL layout work. The only `rtl:` reference is an incidental Tailwind variant inside the vendored shadcn calendar component. |
| Data residency | **Not addressed in code.** Database location is whatever `DATABASE_URL` points at; the AI integration calls an OpenAI-compatible endpoint with no residency constraint. |

The frontend's "auth" is cosmetic: `artifacts/alhumoudi-lawyers/src/lib/auth.tsx`
stores a user object in `localStorage`, and `ProtectedRoute` in `App.tsx` does not
check it — it only wraps the page in the app shell. There is no session, no token,
and nothing server-side to enforce.

### Implications for any work in this repo

- **Do not deploy this against real client data.** It has no access control.
- When adding a table, it needs a tenant key. When adding an endpoint, it needs
  to be scoped to the caller's firm. Raise it rather than following the existing
  unscoped pattern.
- Tenant scoping is not a filter you add per query — it is an invariant. Prefer
  an approach that fails closed (enforced at the connection/session or middleware
  layer) over one that depends on every future query remembering a `WHERE` clause.
- Assume the API surface will change. The OpenAPI spec below describes the
  prototype, not the target contract.

---

## Architecture as it stands today

pnpm workspace monorepo. Deployable apps in `artifacts/`, shared packages in
`lib/`. Package names follow `@workspace/<dir>`.

```
artifacts/
  api-server/          Express 5 JSON API, all routes under /api
  alhumoudi-lawyers/   React 19 + Vite 7 SPA (20 routes)
  mockup-sandbox/      Component preview sandbox
lib/
  db/                  Drizzle schema + pg client  (@workspace/db)
  api-spec/            openapi.yaml + Orval config — source of truth for the API
  api-zod/             GENERATED Zod schemas — used by the server to validate
  api-client-react/    GENERATED React Query hooks — used by the frontend
  integrations-openai-ai-server/   OpenAI-compatible client (server)
  integrations-openai-ai-react/    OpenAI-compatible client (react)
```

**The API contract flows from one file.** `lib/api-spec/openapi.yaml` is
hand-maintained; Orval generates both the server's validation schemas and the
frontend's hooks from it. Edit the spec, then regenerate — do not hand-edit
anything under a `generated/` directory.

**Database schema lives in `lib/db/src/schema/`**, one file per domain,
re-exported by `schema/index.ts`. `lib/db/src/index.ts` builds the `pg.Pool` and
Drizzle client from `DATABASE_URL` and re-exports the schema, so routes import
both `db` and the tables from `@workspace/db`.

16 live tables: `users`, `cases`, `case_activities`, `documents`,
`document_versions`, `time_entries`, `invoices`, `expenses`, `tasks`,
`contracts`, `contract_payments`, `ai_drafts`, `chat_channels`, `chat_messages`,
`knowledge_base`, `ai_settings`. None of them are tenant-scoped.

Schema is applied with `drizzle-kit push`. There is no migrations directory, so
schema history is not tracked — worth changing before this platform is
multi-tenant and carrying real data.

---

## The v1 rebuild: `apps/` and `packages/`

The replacement lives in a separate tree — `apps/api` (NestJS), `packages/db`,
`packages/shared` — and does not share code, schema, or a database with the
prototype above. Decisions are recorded in `docs/decisions/`; the adversaries
the design answers to are in `docs/threat-model.md`.

### Migrations are hand-written, and `drizzle-kit generate` is not used

`packages/db/migrations/` holds numbered `.sql` files applied by
`pnpm --filter @legal/db run migrate`. There is no `generate` script, and adding
one back would be a mistake.

Tenant isolation is enforced in the database, and most of what enforces it is
not expressible as a schema diff: row-level security policies, `FORCE ROW LEVEL
SECURITY`, the unprivileged `legal_app` role, and per-table grants that
deliberately withhold `DELETE`. Drizzle-kit neither generates those nor knows
they exist, so a generated migration would silently omit the parts that make a
table safe — and worse, would diff against a snapshot that stopped tracking
reality at 0000 and emit `CREATE TABLE` for tables that already exist.

So, when adding a table:

- Write the Drizzle schema file (types and queries read from it) **and** a
  hand-written migration. They are maintained together; nothing generates one
  from the other.
- Carry a non-nullable `firm_id` and reference parents with a composite foreign
  key — `FOREIGN KEY (firm_id, user_id) REFERENCES users (firm_id, id)` — so a
  cross-firm reference cannot be represented.
- `ENABLE` **and** `FORCE ROW LEVEL SECURITY`, with `SELECT`/`INSERT`/`UPDATE`
  policies in the established fail-closed form. Absent tenant context must read
  as zero rows, never as every row.
- No `DELETE` policy and no `DELETE` grant. Records are archived, revoked, or
  superseded.
- Grant explicitly to `legal_app`. There is no `ALTER DEFAULT PRIVILEGES`, so a
  new table is unreachable until someone grants it on purpose.

Migrations are immutable once applied. Fix a mistake with a new migration that
drops and recreates, never by editing a file already in the database.

---

## Planned AI capabilities

Five capabilities are planned. None of them exist in usable form today — the
prototype has a single keyword-matching assistant and a draft-approval workflow,
described under "Current state" above.

1. **Document search in Arabic.** Search across a firm's own documents, with
   Arabic as the primary query and content language.
2. **Work plan generation.** Generate a plan of work for a case or matter.
3. **Employee work tracking.** Surface what staff are working on and how effort
   is distributed across cases.
4. **Legal advice grounded in the firm's own documents.** Answers cite and derive
   from that firm's material rather than from the model's general knowledge.
5. **Document drafting.** Generate legal drafts for review.

### Two hard constraints

**AI inference must respect Saudi data residency.** Client documents and prompts
constructed from them are client data — sending them to an out-of-Kingdom
inference endpoint moves that data out of Kingdom, regardless of whether it is
retained. This applies to every model call in the pipeline, not just the final
answer: embedding generation, reranking, summarization, and any evaluation or
logging path that receives document text are all subject to it. The current
integration (`lib/integrations-openai-ai-server/`) calls an OpenAI-compatible
endpoint with no residency constraint, so it is not a usable foundation as-is.

**Retrieval must be tenant-scoped.** A firm must never receive another firm's
documents in an AI answer. Retrieval is the highest-risk path in the system for
the tenant-isolation invariant, because it is a query route that bypasses the
per-endpoint reasoning applied to normal CRUD:

- Scope the retrieval query itself, and scope it as a **pre-filter**. Filtering a
  top-k result set after the fact is both a correctness bug (it silently returns
  fewer results than requested) and a leak waiting on one missed code path.
- If a shared vector index is used, tenant identity must be part of the index
  query, not applied afterward. A per-tenant index or namespace is easier to
  argue correct.
- The prompt is a disclosure surface. Anything placed in context will be
  surfaced to the user, so a cross-tenant document reaching the context window
  has already leaked, whether or not the model quotes it.
- Watch shared state: conversation history, cached embeddings, prompt caches, and
  any global knowledge base are all cross-tenant by default unless designed
  otherwise. The existing `knowledge_base` and `ai_settings` tables are currently
  firm-agnostic and single-row respectively.
- Cross-tenant retrieval should be tested for directly, not assumed from code
  review.

### Notes for whoever builds this

- **Arabic search needs normalization, not just a language setting.** Diacritics
  (tashkeel), alef and hamza variants (`أ إ آ ا`), and taa marbuta (`ة` / `ه`)
  mean the same query and document text can differ byte-for-byte. `ILIKE`, which
  is what the prototype uses, handles none of this and does no morphological
  matching. Decide the normalization scheme before the index is built.
- **Residency constrains model choice, and model choice constrains Arabic
  quality.** These two requirements pull against each other — the in-Kingdom
  options may not be the strongest Arabic models. Worth resolving early, since it
  affects retrieval design, not just a config value.
- **Employee work tracking is personal data.** It is the one capability here whose
  subject is staff rather than clients, which brings PDPL considerations and
  likely internal-transparency expectations. Confirm the requirements before
  designing it rather than treating it as another reporting view over
  `time_entries` and `tasks`.
- **Grounded advice needs provenance.** "Grounded in the firm's own documents"
  implies answers carry citations back to source documents, which is a retrieval
  and storage design decision, not something added to the prompt later.
- **Drafting already has the right shape.** The existing `ai_drafts`
  human-approval workflow is worth preserving — generated legal text should stay
  reviewable before use.

---

## Commands

```bash
pnpm install                                      # pnpm only; npm/yarn are rejected

pnpm --filter @workspace/api-server run dev       # API (needs PORT and DATABASE_URL)
pnpm --filter @workspace/alhumoudi-lawyers run dev # SPA (needs PORT and BASE_PATH)

pnpm --filter @workspace/db run push              # apply schema (dev only)
pnpm --filter @workspace/api-server run seed      # demo data
pnpm --filter @workspace/api-spec run codegen     # regenerate hooks + Zod from openapi.yaml

pnpm run typecheck                                # all packages
pnpm run build                                    # typecheck + build all
```

Required env: `DATABASE_URL`, plus `PORT` for each app (neither has a default —
both throw without it) and `BASE_PATH` for the SPA. The AI features need an
OpenAI-compatible endpoint and key.

In dev, Vite proxies `/api` to `http://localhost:8080`, so the API should run on
port 8080 to match.

---

## Known sharp edges

- **`replit.md` is stale.** It is mostly an unfilled template and states the API
  runs on port 5000, which contradicts the Vite proxy. `README.md` is accurate
  about the prototype; this file is authoritative about intent.
- **Two dead schema files.** `lib/db/src/schema/conversations.ts` and
  `messages.ts` define tables but are not exported from `schema/index.ts`, so
  `drizzle-kit push` never creates them. Chat actually uses `chat_channels` /
  `chat_messages` from `chat.ts`.
- **The codegen script contains a `sed` hack** rewriting `zod.int()` to
  `zod.number()` in generated output.
- **AI retrieval is naive.** `routes/ai.ts` splits the question on whitespace and
  `ILIKE`s words longer than three characters against the knowledge base. This is
  both low-quality retrieval and, once multi-tenant, a cross-firm data-leak path.
- **The default AI system prompt hardcodes one firm** in
  `lib/db/src/schema/ai_settings.ts`.

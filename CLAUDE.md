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

# Legal Platform v2 — Alhumoudi Lawyers

An internal practice-management platform for a law firm: case and matter management, document versioning, time tracking and billing, task assignment, contract management, team chat, and an AI assistant with a human-approval workflow for generated legal drafts.

> **Status: prototype / work in progress.** Authentication is not implemented and every API endpoint is currently public. Do not deploy this against real client data until the items in [Security status](#security-status) are resolved.

---

## Table of contents

- [Stack](#stack)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment variables](#environment-variables)
- [Running locally](#running-locally)
- [Database](#database)
- [API code generation](#api-code-generation)
- [API surface](#api-surface)
- [Data model](#data-model)
- [Features](#features)
- [Security status](#security-status)
- [Common commands](#common-commands)
- [Troubleshooting](#troubleshooting)

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24 |
| Language | TypeScript 5.9 |
| Package manager | pnpm (workspaces) |
| API | Express 5 |
| Database | PostgreSQL |
| ORM | Drizzle ORM + `drizzle-zod` |
| Validation | Zod (`zod/v4`) |
| API codegen | Orval (OpenAPI → React Query hooks + Zod schemas) |
| Frontend | React 19, Vite 7, Tailwind CSS 4, wouter, TanStack Query |
| UI components | shadcn-style primitives, lucide-react, framer-motion |
| AI | OpenAI-compatible chat completions (streamed over SSE) |
| Build | esbuild (server bundle), Vite (client) |

---

## Repository layout

```
.
├── artifacts/                    # Deployable applications
│   ├── api-server/               # Express API (port 8080)
│   │   └── src/
│   │       ├── app.ts            # Express app + middleware
│   │       ├── index.ts          # HTTP listener
│   │       ├── seed.ts           # Demo data seeder
│   │       ├── lib/              # chat-bus (SSE), date-utils, logger
│   │       └── routes/           # One router per domain
│   ├── alhumoudi-lawyers/        # React SPA (port 23804)
│   │   └── src/
│   │       ├── pages/            # Route-level screens
│   │       ├── components/       # Layout + UI primitives
│   │       ├── hooks/
│   │       └── lib/              # auth context, query client, utils
│   └── mockup-sandbox/           # Component preview sandbox (port 8081)
│
├── lib/                          # Shared workspace packages
│   ├── db/                       # Drizzle schema + client (@workspace/db)
│   ├── api-spec/                 # OpenAPI spec + Orval config
│   ├── api-zod/                  # Generated Zod schemas (@workspace/api-zod)
│   ├── api-client-react/         # Generated React Query hooks
│   └── integrations/             # OpenAI client wrappers (server + react)
│
├── scripts/
├── pnpm-workspace.yaml           # Workspace + dependency catalog
└── tsconfig.base.json
```

Package names follow `@workspace/<dir>` and are imported as such across the monorepo.

---

## Prerequisites

- **Node.js 24+** — `node -v`
- **pnpm 9+** — `npm install -g pnpm` (the `preinstall` hook rejects npm and yarn)
- **PostgreSQL 14+** — a local instance or a hosted database (Neon, Supabase, RDS)
- An **OpenAI-compatible API endpoint and key** for the AI assistant features

---

## Installation

```bash
git clone https://github.com/fahoody236/legal_platform_v2.git
cd legal_platform_v2
pnpm install
```

Create a `.env` file in the repository root (see below), then push the schema and seed:

```bash
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run seed
```

---

## Environment variables

| Variable | Required | Used by | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | `@workspace/db`, drizzle-kit | Postgres connection string, e.g. `postgresql://user:pass@localhost:5432/legal_platform` |
| `PORT` | Yes | `api-server` | Port for the API server. The server throws on startup if unset. `8080` in dev. |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Yes (for AI) | `@workspace/integrations-openai-ai-server` | API key for the chat-completions provider |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Yes (for AI) | `@workspace/integrations-openai-ai-server` | Base URL of the OpenAI-compatible endpoint |
| `NODE_ENV` | No | build | `development` or `production` |

Example `.env`:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/legal_platform
PORT=8080
AI_INTEGRATIONS_OPENAI_API_KEY=your_key_here
AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1
```

Never commit `.env`. Secrets belong in your host's secret manager.

---

## Running locally

Two processes, in separate terminals.

**API server** — http://localhost:8080/api

```bash
pnpm --filter @workspace/api-server run dev
```

**Web app** — http://localhost:23804

```bash
pnpm --filter @workspace/alhumoudi-lawyers run dev
```

Optional component sandbox on http://localhost:8081/__mockup:

```bash
pnpm --filter @workspace/mockup-sandbox run dev
```

Health check: `curl http://localhost:8080/api/healthz`

### Logging in

The login screen is currently a **mock**. Any email and password will be accepted. An email containing `admin` yields the `admin` role; anything else yields `lawyer`. The session is stored in `localStorage` and is not verified by the server.

---

## Database

Schema lives in `lib/db/src/schema/`, one file per table, re-exported from `index.ts`.

```bash
# Apply schema changes to the database (development only)
pnpm --filter @workspace/db run push

# Force-apply when drizzle-kit prompts about a destructive change
pnpm --filter @workspace/db run push-force

# Populate demo data
pnpm --filter @workspace/api-server run seed
```

There are no migration files in the repo — the project uses `drizzle-kit push`, which diffs the schema directly against the database. Before going to production, switch to generated migrations (`drizzle-kit generate` + `migrate`) so schema changes are reviewable and reversible.

---

## API code generation

The OpenAPI spec in `lib/api-spec/` is the source of truth for the API contract. Orval generates the Zod schemas used by the server routes and the React Query hooks used by the client.

```bash
pnpm --filter @workspace/api-spec run codegen
```

Run this after any change to the spec. Do not hand-edit files under `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/` — they are overwritten.

---

## API surface

All routes are mounted under `/api`.

| Domain | Endpoints |
|---|---|
| Health | `GET /healthz` |
| Users | `GET /users`, `GET /users/me`, `GET /users/:id`, `POST /users`, `PATCH /users/:id`, `DELETE /users/:id` |
| Cases | `GET /cases`, `GET /cases/:id`, `POST /cases`, `PATCH /cases/:id`, `DELETE /cases/:id`, `GET /cases/conflict-check`, `GET|POST /cases/:id/timeline`, `GET|POST /cases/:caseId/documents` |
| Documents | `GET /documents`, `GET /documents/:id`, `GET /documents/:id/versions`, `PATCH /documents/:id`, `DELETE /documents/:id` |
| Billing | `GET|POST /invoices`, `GET|PATCH|DELETE /invoices/:id`, `GET|POST /time-entries`, `GET /time-entries/summary`, `GET|PATCH|DELETE /time-entries/:id`, `GET|POST /expenses`, `PATCH|DELETE /expenses/:id` |
| Tasks | `GET|POST /tasks`, `GET|PATCH|DELETE /tasks/:id` |
| Contracts | `GET|POST /contracts`, `GET|PATCH|DELETE /contracts/:id`, `GET|POST /contracts/:id/payment-schedules` |
| Dashboard | `GET /dashboard/stats`, `/dashboard/recent-activity`, `/dashboard/upcoming-deadlines`, `/dashboard/lawyer-performance` |
| Calendar | `GET /calendar/events` |
| Chat | `GET|POST /chat/channels`, `GET|POST /chat/channels/:id/messages`, `GET /chat/channels/:id/stream` (SSE) |
| AI drafts | `GET|POST /ai-drafts`, `GET /ai-drafts/:id`, `PATCH /ai-drafts/:id/approve`, `PATCH /ai-drafts/:id/reject` |
| AI | `POST /ai/ask` (SSE), `POST /ai/generate-draft`, `GET|PUT /ai/settings`, `GET|POST|DELETE /ai/knowledge-base`, `POST /ai/knowledge-base/upload`, `POST /ai/knowledge-base/import-document/:documentId` |

---

## Data model

| Table | Purpose |
|---|---|
| `users` | Lawyers, admins, support staff. Holds bar number, specialization, billable rate. |
| `cases` | Matters — client details, case type, jurisdiction, court, deadlines, assigned lawyer. |
| `case_activities` | Timeline entries against a case. |
| `documents` / `document_versions` | Case documents with version history. |
| `time_entries` | Billable and non-billable time logged against cases. |
| `invoices` | Client invoices. |
| `expenses` | Disbursements and case expenses. |
| `tasks` | Assignable work items with due dates. |
| `contracts` | Contract records and payment schedules. |
| `ai_drafts` | AI-generated documents pending human review, with approve/reject audit fields. |
| `knowledge_base` | Firm documents ingested as context for the AI assistant. |
| `ai_settings` | Model selection and system prompt for the assistant. |
| `chat` / `conversations` / `messages` | Internal team messaging. |

**Note:** foreign keys are not currently declared. Columns such as `cases.assigned_lawyer_id`, `documents.case_id`, and `documents.uploaded_by_id` are plain integers with no referential constraints, so orphaned rows are possible.

---

## Features

- **Case management** — full CRUD, status tracking, jurisdiction and court fields, statute-of-limitation and hearing deadlines, per-case activity timeline, and a conflict-check lookup.
- **Documents** — metadata, tagging, draft/final/archived status, version history.
- **Billing** — time entries with billable rates, invoices, expense tracking, and summary aggregations.
- **Tasks** — assignment, priority, and due dates.
- **Contracts** — contract records with linked payment schedules.
- **Team chat** — channels and messages, delivered live over server-sent events.
- **Dashboard** — KPI stats, recent activity, upcoming deadlines, per-lawyer performance.
- **AI assistant** — streamed Q&A grounded in an uploaded firm knowledge base (PDF or text), plus legal-draft generation. Every generated draft lands in an approval queue and must be explicitly approved or rejected before use.

---

## Security status

These are known and outstanding. They are listed here so nobody deploys this by mistake.

- **No authentication.** The login page is a mock; no session, token, or password hashing exists anywhere in the codebase.
- **No authorization.** Every endpoint is unauthenticated and unguarded. The `users.role` column is never checked server-side, so any caller can read, modify, or delete any record — including approving AI drafts they authored.
- **`GET /users/me` returns the first admin row** in the table rather than the calling user.
- **CORS is fully open** (`cors()` with no configuration), and there is no rate limiting or `helmet`.
- **`PUT /ai/settings` is unauthenticated**, allowing anyone to rewrite the firm-wide system prompt or change the model.
- **No multi-tenancy.** The schema has no firm or tenant identifier; the deployment assumes a single firm.
- **No automated tests.**

Suggested order of work: real authentication → `requireAuth` / `requireRole` middleware on the router → restrict CORS and add rate limiting → declare foreign keys → decide single-tenant vs. multi-tenant before building further.

Given the sensitivity of attorney–client data and the requirements of Saudi Arabia's PDPL, resolve authentication and authorization before any real matter data is entered.

---

## Common commands

```bash
pnpm install                                        # install all workspace deps
pnpm run typecheck                                  # typecheck every package
pnpm run build                                      # typecheck + build everything

pnpm --filter @workspace/api-server run dev         # API in dev
pnpm --filter @workspace/api-server run build       # esbuild bundle → dist/index.mjs
pnpm --filter @workspace/api-server run seed        # seed demo data

pnpm --filter @workspace/alhumoudi-lawyers run dev  # web app in dev
pnpm --filter @workspace/alhumoudi-lawyers run build

pnpm --filter @workspace/db run push                # apply schema to DB
pnpm --filter @workspace/api-spec run codegen       # regenerate API client + schemas
```

---

## Troubleshooting

**`Use pnpm instead`** — the `preinstall` hook blocks npm and yarn. Install pnpm and retry.

**`DATABASE_URL must be set`** — the database client throws at import time. Confirm `.env` is present and loaded before starting the API server.

**`PORT environment variable is required`** — the API server refuses to start without an explicit port. Set `PORT=8080`.

**`AI_INTEGRATIONS_OPENAI_API_KEY must be set`** — AI routes require both the key and the base URL. Set both, or avoid the `/ai/*` endpoints.

**Frontend requests 404** — check that the API is running on `8080` and that the client's base URL points at `/api`.

**Type errors after editing the OpenAPI spec** — regenerate with `pnpm --filter @workspace/api-spec run codegen`; the generated Zod and React Query files are not updated automatically.

---

## License

MIT

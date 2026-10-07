# Roadmap

The phase plan this project has followed since the rebuild. Update this file at the end of every phase, in the same commit that closes it.

Last updated: 2026-10-07, after rate limiting.

## Where we are

| Status | Phase | Delivers | Closed by |
|---|---|---|---|
| Done | **0 — Foundation** | Repo, Docker, migrations, tenant isolation (RLS), repository layer, test harness, threat model, decision log | 7 isolation tests |
| Done | **1 — Identity** | Sign-in, firms and tenancy, permission engine, audit log | migrations 0005–0009 |
| Done | **2 — Cases and clients** | Clients, cases, tasks, Arabic search, dashboard, role management screens | 14 of 14 items; migrations 0010–0015 |
| Done | **2.5 — Design** | One design system, Arabic and RTL, applied to every screen | `f5c8e68` |
| Done | User management and invitations | Add, edit and disable users; invitations | migration 0016 |
| Done | Court hearings | Hearings and adjournment | `920a00e`, migration 0017 |
| Done | **3 — Documents** | Upload, versions, download, archive, content-based type check, download separate from view | `26920ef`, migration 0018 |
| Done | Rate limiting | One limiter over every route, trusted-proxy address rule, streaming uploads with concurrency caps, `X-Powered-By` removed | ADR 0007 |
| Next | **2.6 — iPad and touch** | Tables, tap targets, forms (about 1 week) | — |
| Not started | **4 — Pilot goes live** | Deployment; Alhumoudi starts using it (about 3 weeks) | — |
| Not started | **5 — Time and billing** | Time tracking and internal invoices (about 5 weeks) | — |
| Not started | **6 — AI** | Search, work plans, tracking, drafting, advice (about 8 weeks) | — |

State of the database: 19 migrations applied (0000–0018), 14 tenant-isolation tests passing; 71 API unit tests (limiter, address rule, storage handles, type check).

## Required before Phase 4

Phase 4 puts a real firm's client data on the platform. None of these is done.

- A server inside the Kingdom. Not bought yet.
- Production document storage. Local disk is refused in production. Google Drive is the temporary plan, and it needs confirmation that files stay in-Kingdom; a Drive share link would also bypass the permission check and the audit log (ADR 0006).
- Domain `orginoo.com`: `PLATFORM_DOMAIN`, wildcard DNS, SSL.
- `TRUSTED_PROXIES` set to the real proxy addresses, and `DATABASE_APP_URL` for the API (ADR 0007). Both refuse to start when absent in production.
- A mail transport for invitations. Links are copied by hand today (ADR 0005).
- Virus scanning. The seam exists; the scanner does not.
- Legacy `.doc` and `.xls` support. Refused today; law firms hold many of these.
- An independent penetration test before real client data is entered.
- Legal pack: data processing agreement, terms of service, privacy policy, PDPL position.
- A numeric definition of pilot success. Never written.
- Backups with a tested restore.

## Parked

Decided to leave for later. Each needs a decision before it is built.

- `adjourned_to_hearing_id`, to make the adjournment chain queryable
- Firm name in the sidebar (`/auth/me` needs `firms.name_ar`)
- Colours
- Notifications
- Hijri dates (ask the pilot firm first)
- Conflict-of-interest check (in the original Phase 2 scope, not built)
- Record-level scope: "my cases" versus "all cases", for cases and documents (ADR 0004, ADR 0006)
- Documents in the dashboard activity feed
- Orphaned-file cleanup and per-firm encryption keys (ADR 0006)
- In-Kingdom hosting for AI inference. This blocks Phase 6.
- A shared rate-limit store (Redis), before a second API instance. The memory store multiplies every limit by the instance count (ADR 0007).
- Upload byte budget per firm per day: a storage quota, with billing in Phase 5 (ADR 0007).

## Standing rules

- No delete anywhere in the product. Archive, close or cancel.
- The application never connects to Postgres as `postgres`.
- Applied migrations are immutable. A change is a new migration.
- Security, quality and operations are not phases. They are gates every phase passes.

## Cut from scope

- Internal chat.
- ZATCA e-invoicing for the legal platform.

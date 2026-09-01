# 0004 — Firm-defined roles, deny by default

Status: Accepted — 2026-09-01

## Context

Firms differ in how they distribute work, so the platform cannot ship a hierarchy and expect it to fit. What
it can fix is the vocabulary of permissions, and the rule that nothing is allowed unless something says so.

## Model

A **permission** is a `resource.action` pair — `cases.view`, `documents.download`. The catalogue is
platform-defined and global; firms never invent one. A **role** is a named set of permissions owned
by one firm. A user holds any number of roles and their effective permissions are the union. No
inheritance and no ranking: hierarchy is what a firm expresses by choosing which permissions to group.

`documents.download` is separate from `documents.view` deliberately, so a firm can allow filing and
organising without allowing files to leave the building (docs/threat-model.md, departing employee).

## Tables

- `permissions` — global reference: key, resource, action, description. No `firm_id`; read-only.
- `roles` — `(id, firm_id, name, description)`. Tenant-owned, under RLS like everything else.
- `role_permissions` — `(firm_id, role_id, permission_key)`, composite FK to `roles (firm_id, id)`.
- `user_roles` — `(firm_id, user_id, role_id)`, composite FKs to both parents. The composite keys
  make a cross-firm grant unrepresentable rather than merely unlikely.

`role_permissions` and `user_roles` rows are deleted on revocation, unlike the rest of the schema. The
no-delete rule protects legal records — cases, documents, audit entries — where the record *is* the
artefact. Role composition and assignment are configuration; what must survive is the history of the
change, which the audit log holds. A tombstoned grant would put that history in the worst place: every
effective-permission query would have to exclude it, and forgetting once restores revoked access.
`roles` itself is still archived rather than deleted, so a role named in the audit trail stays nameable.

## Checking a request

The session guard resolves the user; a permission guard then compares the permission declared on the
handler against that user's effective set, loaded inside `withTenant` on the same request. Both are
global guards, so both run for every route without being wired in per controller.

## Editing a role while someone is signed in

Permissions are read per request and never stamped onto the session cookie. A role edited at 10:00 is
in force on the next request: nothing is cached, so nothing needs invalidating and no window exists in
which revoked access still works. The cost is one indexed query per request — the right trade where
stale permissions are a confidentiality failure. Any future cache key must carry a role version.

## Deny by default, mechanically

Two mechanisms, neither of them a convention:

1. The permission guard is global and treats *absent* metadata as denial. A route with no declaration
   returns 403, not 200. Opting out takes an explicit declaration on the route, where review sees it:
   `@RequirePermission(...)`, `@Public()`, or `@SessionOnly()` for the two routes whose resource is the
   session itself — signing out, and reading back who you already are.
2. A boot-time check walks Nest's route table and refuses to start if any route declares none of those,
   so the omission cannot reach a running environment. **Not built** — see Deferred.

The first makes the mistake harmless, the second makes it loud. Only the first exists today, which is
the right half to have if only one. Same shape as the database, where RLS is deny-by-default and the
absent DELETE policy *is* the denial.

## Every firm keeps an admin

A firm with nobody holding `roles.manage` can no longer administer itself. The edit that would remove the
last holder is refused by a database trigger, so it holds against a script as well as the interface.

## Deferred

**The boot-time route check.** Blocked on a route-table API that holds up. `ApplicationConfig` owns the
authoritative guard order but is constructed by `NestFactory` rather than provided, so it cannot be
injected; `DiscoveryService.getProviders()` does expose both guards, but in module *scan* order, which
was observed to differ from the *instantiation* order that determines when each guard registers. An
index comparison over it would be a check that confidently reports the wrong answer, which is worse
than no check. Settling it needs the guards instrumented at request time to establish ground truth.

**Guard order is load-bearing and unasserted.** The permission guard reads the session the session
guard attaches, so the two must run in that order. Nothing enforces it: it holds because Nest
registers global guards as their providers resolve, and `AppModule` imports `AuthModule` before
`PermissionsModule`. A reordered import list would break it silently at the source and visibly at
runtime — the permission guard rejects a request with no session attached, so an inversion denies
every authenticated caller on a gated route rather than admitting an unauthenticated one. Safe, and
hard to diagnose from the symptom. Asserting it is half of the deferred check above.

**Record-level scope** — "all cases" versus "cases I am assigned to" — is a property of a grant rather
than a separate permission. It is needed, and it is not designed here.

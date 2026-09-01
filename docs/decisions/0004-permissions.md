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
   returns 403, not 200. Opting out takes an explicit `@Public()` on the route, where review sees it.
2. A boot-time check walks Nest's route table and refuses to start if any route declares neither a
   permission nor `@Public()`, so the omission cannot reach a running environment.

The first makes the mistake harmless, the second makes it loud. Same shape as the database, where RLS
is deny-by-default and the absent DELETE policy *is* the denial.

## Every firm keeps an admin

A firm with nobody holding `roles.manage` can no longer administer itself. The edit that would remove the
last holder is refused by a database trigger, so it holds against a script as well as the interface.

## Deferred

Record-level scope — "all cases" versus "cases I am assigned to" — is a property of a grant rather
than a separate permission. It is needed, and it is not designed here.

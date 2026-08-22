# 0002 — Tenant isolation by row-level security

Status: Accepted — 2026-08-22

## Context

Many independent law firms share one deployment. One firm reading another's
cases is the failure this product cannot survive.

## Decision

Shared database, shared schema. Every tenant-owned table carries a non-nullable
`firm_id`, and PostgreSQL Row Level Security confines each query to the firm set
on the connection — a forgotten `WHERE` returns zero rows, not another firm's data.

## Rejected: schema-per-tenant

Isolation is stronger by construction, but every migration must then run once per
firm, and that does not scale operationally.

## Risk

RLS must be tested, not assumed — one misconfigured policy leaks a firm's cases
to another. It is also ignored entirely for superusers and roles with BYPASSRLS.

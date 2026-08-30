# 0003 — Firms are identified by subdomain

Status: Accepted — 2026-08-30

## Context

Sign-in is the one request that arrives with no tenant context — every other request derives the
firm from the session, but login has to establish it from nothing.

## Decision

Each firm gets a subdomain: `alhumoudi.platform.sa`. The host identifies the firm before any query
runs, so login is scoped like every other request and needs no exception to the isolation model in
0002.

## Rejected: email lookup

Better user experience — one field, no URL to remember. But it needs a query that reads across every
firm. That component would exist permanently and invite reuse for password reset, admin search, and
support tooling, eroding the "no exceptions" property one caller at a time.

## Rejected: firm code on the login form

No exception to the model, but a code to look up before signing in is poor user experience and a
recurring support burden.

## Costs accepted

Wildcard DNS and a wildcard TLS certificate; subdomain-to-firm routing on every request; firms must
know their own URL; local development needs subdomain support.

# 0001 — All packages use ESM

Status: Accepted — 2026-08-22

## Context

`@legal/shared` is imported by both the NestJS backend and the browser
frontend. If the two halves of the monorepo disagree about module format,
that package has to ship a dual CJS/ESM build.

## Decision

Every package sets `"type": "module"`, the NestJS backend included.
`@legal/shared` is authored and consumed as ESM everywhere, with no dual
build and no conditional exports.

## Consequences

NestJS conventionally runs on CommonJS, so the backend departs from the
documented default: its `tsconfig` needs `"module": "nodenext"` rather
than `"commonjs"`. ESM support across the Nest ecosystem is thinner than
the CJS path, so expect rougher edges in tooling and third-party modules.

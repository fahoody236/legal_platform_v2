# 0007 — Rate limiting: one limiter, absent means limited

Status: Accepted — 2026-10-07

## Context

Until now only sign-in was limited, in memory, inside its own controller. Everything else was open: the
public invitation routes, search, and document upload — which held up to 50 MB in memory per request with no
cap on how many. The threat model's external attacker (credential stuffing, an unguarded endpoint) and its
departing employee (bulk download) both route through volume.

The fact that drives most of the numbers: the pilot firm is about thirty people behind one office address.

## Model

One limiter, as a store behind an interface (`RateLimitStore`: a fixed-window counter and an in-flight slot
counter), a policy table, and two enforcement points.

A route declares a **class** with `@RateLimit("…")`. A route that declares nothing gets `read`. `exempt`
has to be written out, and only `/health` carries it. Same rule as permissions: absent is limited, not open.

| Class | Routes | Limits | Concurrency |
|---|---|---|---|
| `auth` | sign-in | 100 / IP, 10 / email, per 15 min | — |
| `invitation-lookup` / `-accept` | the two public invitation routes | 60 / 40 per IP per 15 min | — |
| `read` (default) | every GET, `/auth/me` | 120 / user, 1,500 / firm, per minute | — |
| `write` | every POST/PATCH not below, sign-out | 30 / user, 300 / firm, per minute | — |
| `search` | `/search` | 60 / user, 600 / firm, per minute | — |
| `invite` | create user, resend invitation | 30 / user, 60 / firm, per hour | — |
| `upload` | new document, new version | 300 / user, 1,500 / firm, per hour | 2 / user, 8 / firm, 20 / process |
| `download` | version download | 100 / user / hour, **500 / user / day**, 1,000 / firm / hour | 3 / user |

Two rules sit outside the classes. A **flood ceiling** of 1,000 / minute per address runs before the tenant
middleware, so a refused request costs no database call. An **unauthenticated** rule of 600 / 15 min per
address counts requests to authenticated routes that end 401, and is consumed only on that path.

## Nested rules, and what a refusal costs

A class's rules are ordered narrow to wide — user before firm, hour before day — and consumption stops at the
first refusal. A request the user rule refuses costs the firm nothing. Consuming everything would turn one
runaway script into an outage for its colleagues: 2,000 requests a minute from one stolen session would spend
the firm's 1,500 and refuse the other twenty-nine people, which is what the per-user rule exists to prevent.
The same property is what makes the daily download ceiling honest — a refused download took nothing, so it
spends nothing.

`auth` is the exception and says so (`consumeAll`). Its two dimensions, address and email, are independent,
not nested; stopping at the first refusal there would let a caller who tripped the address rule keep the
email budget intact by switching address.

## Keys

Public routes by address. Authenticated routes by user, with the firm ceiling above. The firm rule is what
keeps one firm from starving the instance; the user rule is what keeps one person from starving the firm.

The email key is a SHA-256 of the normalised address. The guard reads the body before validation, so the
value is whatever the client sent, up to the body-parser's limit; a 100 KB string as a map key is a memory
lever, and the store should not be a second place holding email addresses in clear.

## The client address

Every site reads one value, resolved once by the first middleware: the socket peer, unless the peer is in
`TRUSTED_PROXIES`, in which case `X-Forwarded-For` is read from the right and the first address not itself a
trusted proxy is the client. A header from a non-proxy peer is discarded unparsed. A forged header through
a real proxy ends up to the left of the address the proxy appended, where the rule never reaches it.

`TRUSTED_PROXIES` must be set in production, like `MAIL_TRANSPORT`; `none` is a valid answer and has to be
written. A forgotten setting is how a whole firm becomes one address — and under that, sign-in's per-address
limit is a limit on the firm.

## Refusals

429, body `{}`, `Retry-After` in seconds. On the public routes the counters are consumed before any lookup,
so a refusal arrives on the same schedule whether the email or token exists.

One 429 carries a body: the unauthenticated rule's, `{ "code": "unauthenticated" }`. It says what the 401 it
replaces would have said — this request had no valid session — and nothing about any account. The web app
treats it as "go to sign-in", which is outside that rule, rather than as an error.

**What a blocked address can still reach.** The unauthenticated rule is consumed only where a request is
about to be refused anyway. So an address that has tripped it can still sign in, still use an invitation,
still reach `/health`, and every request carrying a valid session goes through untouched. What the address
loses is being refused faster on requests that would have been refused regardless.

Refusals are audited (`ratelimit.refused`; the daily download ceiling under `ratelimit.refused_daily`, so
"who pulls files all day" is a different query from "who had a busy hour"). Each entry is its own transaction,
since a refused request has no action to share one with. The first refusal in a window is recorded and then
every hundredth, each saying how many came before it, so ten thousand refusals are a hundred rows. Refusals
before the tenant middleware have no firm and go to the process log.

## Uploads stream now

An upload is a multer storage engine that pipes the request into the store's staging area — `<uuid>.partial`
under the firm's directory — keeping in memory only a running hash, the first 8 KB and the last ~1.1 MB. The
type check reads that sample: every signature sits in the head, and a zip's central directory sits at the
end; the tail is sized so that any Office file the check would accept has its whole directory inside it (the
entry cap times the longest entry, plus the longest zip comment). A directory that begins before the tail is
refused, never accepted on the part that was visible. Same signatures, same rules, same refusal codes; the
Phase 3 hostile files were re-run and answered identically.

`commit` renames the staging file into place; `abort` unlinks it. The storage layer enforces that `abort`
after `commit` throws and that only a `.partial` path is ever unlinked — a committed object cannot be removed
through a handle however it is used. Staging files are aborted on refusal, on multer's own aborts, and when
the response closes; a startup sweep removes what a dead process left.

The concurrency slot is taken in the guard, before the body is read, and released when the response closes.

## Costs noted, not changed

Every request except `/health` is one uncached database call to resolve the firm; every authenticated request
is additionally one session read and one session write (`last_seen_at`). Both are left alone. The flood
ceiling bounds the first; the unauthenticated rule bounds the second for callers with no session.

## What breaks with two instances

The memory store is per process. Behind a load balancer every limit silently multiplies by the instance
count — and because one client's requests are spread across instances, each sees a fraction and none trips.
A restart clears every window and every in-flight slot. The store interface is two operations; a Redis
implementation is `INCR` + `PEXPIRE` (one script, so a crash cannot split them) and a slot counter with a TTL
as the net for a process that died holding a slot. That has to exist before a second instance does.

## Deferred

- A shared store, with the second instance.
- A byte budget per firm per day for uploads. It is a storage quota and belongs with billing in Phase 5.
- Sliding windows. Fixed windows admit up to twice the limit across a boundary; for limits meant to catch
  floods and scripts, that is acceptable.
- Progressive lockout on sign-in (threat model). The per-credential lockout in the database remains the
  control that survives a restart; this limiter is the one that stops traffic before Argon2.

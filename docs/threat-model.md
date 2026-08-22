# Threat model

Who would attack a shared platform holding privileged Saudi legal work, what they would try, and what stops them.

**Status: the controls below are specified, not built.** The prototype in `artifacts/` has no authentication,
no tenant column, and no row-level security, and its database connection is a PostgreSQL superuser — which
ignores RLS outright. Read every "stops them" as the bar for release, not as today.

## Assets by sensitivity

| Asset | Why it matters | Damage if lost |
|---|---|---|
| Case documents | Privileged filings, evidence, contracts | Highest. Irreversible — privilege cannot be un-waived, and disclosure may be reportable |
| Client identities | Who a firm acts for, against whom | High. The client list alone is commercially valuable and can expose a matter that was never public |
| Credentials | Password hashes, session tokens, TOTP secrets | High. One credential reaches everything above, wearing a legitimate user's face |
| Audit logs | Who read and changed what | High differently. Not secret so much as load-bearing: if it can be edited, nothing else here is provable |

## Adversaries

### A rival firm's employee — a legitimate user of another tenant

**Wants:** a competitor's client list and active matters.

**Route:** ordinary authenticated requests carrying someone else's identifiers — a changed case
id in a URL, paging past the end of a list, a `firm_id` submitted in a body or header, or a
total read off a dashboard tile or a search result count.

**Stops them:** tenant identity taken from the session and never from the request; `firm_id` on
every tenant-owned table under row-level security applied per transaction, so a missing `WHERE`
returns zero rows rather than another firm's file; composite foreign keys that make a
cross-tenant reference unrepresentable; a foreign record answering 404 exactly as a non-existent
one does; and counts computed after filtering, because an aggregate is a disclosure.

### A disgruntled employee of a subscribing firm

**Wants:** to take client files on the way out, or destroy work in place.

**Route:** they are inside, authenticated, and entitled to some of it — bulk download before
resigning, deletion of a case or document, edits to history to cover it.

**Stops them:** scoped permissions, so entitlement to some matters is not entitlement to all;
`documents.download` separable from `documents.view`, so filing access is not exfiltration
access; no delete capability anywhere in the product — archive, close, and cancel are the
lifecycle verbs, and the application's database role holds no `DELETE` on legal records;
append-only audit covering every download and preview; session revocation within 60 seconds of
being disabled.

**Limit:** none of this prevents downloading what they are genuinely entitled to. It makes it
attributable and reviewable, not impossible.

### An opposing party in litigation

**Wants:** the other side's strategy, or a procedural advantage — proof the record was altered,
or that privilege was mishandled.

**Route:** rarely technical. Social engineering of firm staff, a compromised client mailbox, the
password reset flow, or a legal demand for platform records. Failing that, an argument in court
that the system's history is untrustworthy.

**Stops them:** MFA on the accounts worth taking; reset tokens that are single-use, short-lived,
and revoke every existing session; a hash-chained append-only audit trail and per-version
document checksums, so integrity is demonstrable rather than asserted.

### An external attacker after client data

**Wants:** bulk client data, for resale, extortion, or the damage of publishing a firm's files.

**Route:** credential stuffing and password spraying, an unguarded endpoint, injection reaching
the database, a stolen session token, or a malicious upload that executes in the pipeline.

**Stops them:** deny-by-default authorization with a test that fails when any route declares no
permission; per-account and per-address throttling with progressive lockout, and failures that
do not reveal whether an account exists; Argon2id password storage; parameterised queries, with
RLS as the layer that bounds the damage when one is missed; uploads validated by declared type,
detected type, and extension, then malware-scanned before becoming downloadable; object storage
never publicly readable, reached only through short-lived URLs issued after an authorisation
check.

### An insider at the hosting provider

**Wants:** whatever is on the disks, or whatever a support session can reach.

**Route:** storage-layer access, backup copies, or a hypervisor. For our own platform staff, the
equivalent is standing production access used outside an incident.

**Stops them:** encryption at rest with per-tenant keys in a managed key service in-Kingdom, so
possession of storage is not possession of documents. For platform staff, no standing access at
all: support access needs a stated reason, a named person, a scope, an expiry inside 24 hours,
and activation by the firm itself, and it writes into that firm's own audit trail. Break-glass
never extends to document content.

**Limit:** an infrastructure operator with live memory access can reach data in use. That
residual risk is answered by in-Kingdom hosting, contract, and provider selection — not by
application code.

## What is not yet true

Every control above is a specification reference, not a passing test. Before the pilot firm puts
real matters on this platform, at minimum: the application must connect as an unprivileged
database role, RLS must be enabled and directly tested for cross-tenant reads, and every route
must be shown to be guarded. Cross-tenant isolation is tested for, never inferred from review.

# 0005 — Invitations, and where email may be sent from

Status: Accepted — 2026-09-20

## Context

A firm administrator adds a colleague; the colleague needs a first password. The password must be chosen by
the person it belongs to, never typed in by the administrator, so what the administrator creates is a link.
That link is a credential, it travels by email, and both facts have consequences.

## The token

Same construction as a session token: 256 random bits, base64url, and only its SHA-256 in the database
(`invitations.token_hash`). The reasoning on `sessions.token_hash` applies with more force here — a session
token uses an account, an invitation token *sets its password*. A fast hash is right for the same reason:
there is nothing to brute-force in 256 random bits, and a KDF would only make the public route expensive.

One row per issue. A resend inserts a new row and marks earlier open rows `revoked_at`; nothing is
deleted, so the trail shows every link that was ever able to set a given person's password. Seven-day
expiry, single use, and revoked when the user is disabled. The token is looked up inside `withTenant`, so
a link from one firm is inert on another firm's subdomain — the row is not visible there.

The acceptance routes (`POST /invitations/lookup`, `POST /invitations/accept`) are public: the token is
the credential. They take the token in the body, not the path, so it stays out of access logs. The
password is hashed only after the token is found, so a dead token costs one indexed read.

## Where email is sent from

An invitation carries an address, a name, the firm's name, and the link — no client data. But the address
and the firm membership are staff personal data under the PDPL, so a mail provider outside the Kingdom
processing them is a cross-border transfer needing a basis. And the next message through this channel —
an assignment notification naming a case and its client — *is* client data. So outbound mail is held to
the same residency rule as the database.

That leaves two transports: an SMTP relay run on the in-Kingdom infrastructure, or the email service of
whichever Saudi-region cloud hosts the application. Both depend on a hosting decision not yet made, so
**no transport is wired**. `apps/api/src/mail/` defines the interface and two transports that do not send:
`console` (development; refused in production because it prints links to the log) and `none`. Every
invitation response reports `emailSent`, false for both.

## When the email does not arrive

The administrator can **resend**, which issues a new link and kills the old one, and can **see the link**
— once, at creation or resend, never afterwards, since only the hash is kept. Until a transport exists,
this is the delivery mechanism.

It is a stated trade-off. An administrator who holds the link can accept it and act as the new person, and
the audit trail would name the new person. Three things make that survivable: `invitations.created` and
`invitations.resent` record `linkShown: true` and who saw it; `invitations.accepted` records the address
it came from; and a colleague who finds their link already used will say so. Never showing the link would
mean a firm with no working mail cannot bring anyone in.

## Creating a person is not deciding what they may do

`POST /users` is `users.manage` and takes no roles. A route taking both under `users.manage` would let its
holder create an account carrying the administrator role and — holding the link — become it. Roles are
assigned by the existing `PATCH /users/:id/roles` under `roles.manage`; the interface makes both requests
from one form. This follows the one-permission-per-route rule in 0004.

## Deferred

- A real transport, once hosting is decided. The interface is the contract; the wording on the users
  screen already changes when `emailSent` is true.
- Password reset. It is the same token mechanism issued by the person themselves rather than by an
  administrator, and is the obvious next use of this table.
- Changing a user's email address. It is the sign-in identifier; the route does not exist yet.

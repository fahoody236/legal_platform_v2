import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * A signed-in session. Server-side and revocable: the row is the authority, so
 * disabling a user or changing a password can end their access immediately
 * rather than at the next token expiry.
 *
 * ── Why only the hash of the token is stored ──────────────────────────────
 *
 * The bearer token itself is a credential. Anyone holding it is authenticated
 * as that user, without a password and without passing MFA again — the session
 * exists precisely because those checks already happened. So a stored raw token
 * is a live, ready-to-use key to an account.
 *
 * The database is the wrong place to keep such a key, because it is the thing
 * most likely to be read by someone who should not read it: a backup restored
 * to a laptop, a replica with looser access, a SQL injection reaching one
 * SELECT, an operator during an incident, a support engineer under a
 * break-glass grant. Every one of those is a scenario the threat model names.
 * With raw tokens, any of them hands over every live session in the firm. With
 * hashes, they hand over values that cannot be replayed: the hash verifies a
 * token someone presents, but cannot produce one.
 *
 * It also keeps tokens out of everything downstream of the table — query logs,
 * slow-query samples, error reports, `SELECT *` in a console, an exported audit
 * trail. A value that is never usable is a value that is safe to leak.
 *
 * The hash here is a fast one (SHA-256), and that is deliberate rather than an
 * oversight. Password hashing is slow because passwords are low-entropy and
 * worth brute-forcing; a session token is a long random value, so there is
 * nothing to guess and no work factor to buy. A slow KDF would instead be paid
 * on every authenticated request, which is both a latency cost and a denial-of-
 * service lever. Lookup stays a single indexed equality against the hash of
 * what the client presented.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    firmId: uuid("firm_id").notNull(),
    /** SHA-256 of the bearer token. The token itself is never stored. */
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set to revoke. Sessions are ended, never deleted — see below. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.firmId, t.userId],
      foreignColumns: [users.firmId, users.id],
    }),
    unique("sessions_token_hash_key").on(t.tokenHash),
    // Revoking every session for a user, and listing a user's own sessions.
    index("sessions_firm_id_user_id_idx").on(t.firmId, t.userId),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

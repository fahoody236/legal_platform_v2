import { sql } from "drizzle-orm";
import {
  check,
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
 * A link that lets a new user choose their first password.
 *
 * The token is never stored; `token_hash` is its SHA-256, for the reasons
 * given at length on `sessions.token_hash` — and with more at stake, since an
 * invitation token is the power to set someone's password rather than merely
 * to use a session they already opened.
 *
 * One row per issue. A resend inserts a new row and revokes the earlier
 * pending ones, so the history of every link that could ever have set this
 * person's password is kept. Nothing is deleted.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id").notNull(),
    userId: uuid("user_id").notNull(),
    invitedByUserId: uuid("invited_by_user_id").notNull(),
    /** SHA-256 of the token. The token itself is returned once and never kept. */
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set when the person chose a password through this link. */
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    /** Set when superseded by a resend, or when the user was disabled. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.firmId, t.userId],
      foreignColumns: [users.firmId, users.id],
    }),
    foreignKey({
      columns: [t.firmId, t.invitedByUserId],
      foreignColumns: [users.firmId, users.id],
    }),
    unique("invitations_token_hash_key").on(t.tokenHash),
    check(
      "invitations_one_outcome_check",
      sql`${t.acceptedAt} IS NULL OR ${t.revokedAt} IS NULL`,
    ),
    index("invitations_firm_id_user_id_created_at_idx").on(
      t.firmId,
      t.userId,
      t.createdAt,
    ),
  ],
);

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;

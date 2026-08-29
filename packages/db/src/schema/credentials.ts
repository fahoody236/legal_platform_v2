import {
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * A user's password, separated from the user record.
 *
 * Splitting it out means the common reads — a user directory, an assignee
 * picker, a case team — never load a password hash into memory at all, and
 * cannot accidentally serialise one into a response. `users` can be selected
 * with `select *` safely; this table cannot, and keeping them apart makes that
 * distinction structural rather than a rule to remember.
 *
 * There is no delete. A revoked password is a new hash, and an account that
 * should not authenticate is disabled on the user record.
 */
export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    firmId: uuid("firm_id").notNull(),
    /**
     * Argon2id or equivalent — a deliberately slow, memory-hard function.
     * Passwords are low-entropy and guessable, so the cost of each attempt is
     * the defence. Contrast with sessions.token_hash, which is a fast hash for
     * the reasons documented there.
     */
    passwordHash: text("password_hash").notNull(),
    passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Drives progressive backoff; reset on a successful sign-in. */
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite: a credential cannot reference a user in another firm, because
    // the pair (firm_id, user_id) must exist together in users. The cross-firm
    // reference is unrepresentable rather than merely unlikely.
    foreignKey({
      columns: [t.firmId, t.userId],
      foreignColumns: [users.firmId, users.id],
    }),
    unique("credentials_user_id_key").on(t.userId),
  ],
);

export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;

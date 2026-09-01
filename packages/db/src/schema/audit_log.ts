import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { firms } from "./firms.js";
import { users } from "./users.js";

/**
 * The audit trail. Append-only: no UPDATE or DELETE policy exists on this table
 * and `legal_app` holds neither privilege, so an entry cannot be altered or
 * removed by anything the application is able to do. See migration 0009 for
 * what the threat model asks of it and what that protection does not cover.
 *
 * Nothing in this file can express a write other than an insert. There is no
 * update helper in the repository either, and adding one would be a change to
 * the security properties of the platform rather than a convenience.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    /**
     * Null for an unauthenticated event — a failed sign-in against an address
     * that matches no user is precisely the entry worth keeping, and it has no
     * actor to name.
     */
    actorUserId: uuid("actor_user_id"),
    /** Dotted and past tense: `auth.login.succeeded`. */
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    /**
     * Anything that makes the entry readable a year later. Nothing that would
     * be a leak if the trail were disclosed: no password, no session token, no
     * document content.
     */
    detail: jsonb("detail"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.firmId, t.actorUserId],
      foreignColumns: [users.firmId, users.id],
    }),
    index("audit_log_firm_id_created_at_idx").on(t.firmId, t.createdAt.desc()),
    index("audit_log_firm_id_actor_user_id_created_at_idx").on(
      t.firmId,
      t.actorUserId,
      t.createdAt.desc(),
    ),
    index("audit_log_firm_id_resource_idx").on(
      t.firmId,
      t.resourceType,
      t.resourceId,
    ),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;

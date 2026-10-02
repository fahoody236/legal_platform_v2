import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { cases } from "./cases.js";
import { firms } from "./firms.js";
import { users } from "./users.js";

/**
 * An entry in a matter's file — "the statement of claim" — which persists
 * across every revision of the bytes behind it. Mirrored by hand from
 * migration 0018; the database is the authority.
 *
 * Archived, never deleted. The current version is the highest-numbered row in
 * `document_versions`, deliberately not a pointer here (see 0018).
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    caseId: uuid("case_id").notNull(),
    titleAr: text("title_ar").notNull(),
    title: text("title"),
    description: text("description"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    unique("documents_firm_id_id_key").on(t.firmId, t.id),

    foreignKey({
      columns: [t.firmId, t.caseId],
      foreignColumns: [cases.firmId, cases.id],
    }),
    foreignKey({
      columns: [t.firmId, t.createdByUserId],
      foreignColumns: [users.firmId, users.id],
    }),

    check("documents_title_ar_not_blank", sql`btrim(${t.titleAr}) <> ''`),

    index("documents_firm_id_case_id_created_at_idx").on(
      t.firmId,
      t.caseId,
      t.createdAt,
    ),
  ],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

/**
 * One upload of bytes against a document. Append-only: the application role
 * holds SELECT and INSERT on this table and nothing else.
 *
 * `storageKey` is opaque — whatever the storage implementation returned — and
 * nothing outside that implementation may interpret it. `contentType` is the
 * type detected from the content, never the one the browser declared.
 * `checksum` is `sha256:<hex>` of the bytes as received.
 */
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    documentId: uuid("document_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    // `number` is exact up to 2^53, which is some eight petabytes.
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    checksum: text("checksum").notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("document_versions_firm_id_id_key").on(t.firmId, t.id),
    unique("document_versions_firm_id_document_id_version_number_key").on(
      t.firmId,
      t.documentId,
      t.versionNumber,
    ),

    foreignKey({
      columns: [t.firmId, t.documentId],
      foreignColumns: [documents.firmId, documents.id],
    }),
    foreignKey({
      columns: [t.firmId, t.uploadedByUserId],
      foreignColumns: [users.firmId, users.id],
    }),

    check(
      "document_versions_version_number_check",
      sql`${t.versionNumber} >= 1`,
    ),
    check("document_versions_size_bytes_check", sql`${t.sizeBytes} > 0`),
    check(
      "document_versions_checksum_check",
      sql`${t.checksum} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "document_versions_file_name_not_blank",
      sql`btrim(${t.fileName}) <> ''`,
    ),
    check(
      "document_versions_storage_key_not_blank",
      sql`${t.storageKey} <> ''`,
    ),
  ],
);

export type DocumentVersion = typeof documentVersions.$inferSelect;
export type NewDocumentVersion = typeof documentVersions.$inferInsert;

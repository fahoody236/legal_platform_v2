import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  fileType: text("file_type").notNull(), // pdf | docx | xlsx | other
  filePath: text("file_path"),
  status: text("status").notNull().default("draft"), // draft | final | archived
  version: integer("version").notNull().default(1),
  uploadedById: integer("uploaded_by_id"),
  tags: text("tags"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const documentVersionsTable = pgTable("document_versions", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  version: integer("version").notNull(),
  editedById: integer("edited_by_id"),
  changeNote: text("change_note").notNull().default(""),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
export type DocumentVersion = typeof documentVersionsTable.$inferSelect;

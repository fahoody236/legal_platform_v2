import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiDraftsTable = pgTable("ai_drafts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  draftType: text("draft_type").notNull(), // contract | pleading | letter | legal_answer | other
  status: text("status").notNull().default("pending_approval"), // pending_approval | approved | rejected
  content: text("content").notNull(),
  caseId: integer("case_id"),
  createdById: integer("created_by_id"),
  reviewedById: integer("reviewed_by_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNotes: text("review_notes"),
  editsMadeBeforeApproval: text("edits_made_before_approval"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiDraftSchema = createInsertSchema(aiDraftsTable).omit({ id: true, createdAt: true });
export type InsertAiDraft = z.infer<typeof insertAiDraftSchema>;
export type AiDraft = typeof aiDraftsTable.$inferSelect;

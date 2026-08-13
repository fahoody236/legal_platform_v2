import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiSettingsTable = pgTable("ai_settings", {
  id: serial("id").primaryKey(),
  model: text("model").notNull().default("gpt-5.6-terra"),
  systemPrompt: text("system_prompt").notNull().default(
    "You are an expert legal AI assistant for Alhumoudi Lawyers, a Saudi Arabian law firm. " +
    "You help lawyers with legal research, drafting documents, answering questions about cases, " +
    "and analyzing contracts. Always be precise, cite relevant principles when applicable, " +
    "and flag any areas of uncertainty. Respond in the same language as the question (Arabic or English)."
  ),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiSettingsSchema = createInsertSchema(aiSettingsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertAiSettings = z.infer<typeof insertAiSettingsSchema>;
export type AiSettings = typeof aiSettingsTable.$inferSelect;

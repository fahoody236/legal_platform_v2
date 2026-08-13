import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const caseActivitiesTable = pgTable("case_activities", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull(),
  activityType: text("activity_type").notNull(), // filing | communication | hearing | note | document | task
  description: text("description").notNull(),
  performedById: integer("performed_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCaseActivitySchema = createInsertSchema(caseActivitiesTable).omit({ id: true, createdAt: true });
export type InsertCaseActivity = z.infer<typeof insertCaseActivitySchema>;
export type CaseActivity = typeof caseActivitiesTable.$inferSelect;

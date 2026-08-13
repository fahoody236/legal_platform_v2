import { pgTable, text, serial, timestamp, integer, real, boolean, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const timeEntriesTable = pgTable("time_entries", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull(),
  lawyerId: integer("lawyer_id").notNull(),
  hours: real("hours").notNull(),
  hourlyRate: real("hourly_rate").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  description: text("description").notNull(),
  isBillable: boolean("is_billable").notNull().default(true),
  invoiced: boolean("invoiced").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTimeEntrySchema = createInsertSchema(timeEntriesTable).omit({ id: true, createdAt: true });
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type TimeEntry = typeof timeEntriesTable.$inferSelect;

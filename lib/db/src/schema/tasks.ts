import { pgTable, text, serial, timestamp, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  caseId: integer("case_id"),
  assigneeId: integer("assignee_id"),
  createdById: integer("created_by_id"),
  status: text("status").notNull().default("pending"), // pending | in_progress | done | cancelled
  priority: text("priority").notNull().default("medium"), // low | medium | high | urgent
  dueDate: date("due_date", { mode: "string" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;

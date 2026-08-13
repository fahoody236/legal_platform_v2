import { pgTable, text, serial, timestamp, integer, real, boolean, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull(),
  category: text("category").notNull(), // filing_fee | travel | courier | expert | other
  amount: real("amount").notNull(),
  description: text("description").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  submittedById: integer("submitted_by_id"),
  billable: boolean("billable").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertExpenseSchema = createInsertSchema(expensesTable).omit({ id: true, createdAt: true });
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expensesTable.$inferSelect;

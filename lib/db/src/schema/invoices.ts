import { pgTable, text, serial, timestamp, integer, real, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  clientName: text("client_name").notNull(),
  totalAmount: real("total_amount").notNull(),
  paidAmount: real("paid_amount").notNull().default(0),
  retainerApplied: real("retainer_applied").notNull().default(0),
  status: text("status").notNull().default("draft"), // draft | sent | paid | overdue | cancelled
  issuedDate: date("issued_date", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }),
  paidDate: date("paid_date", { mode: "string" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;

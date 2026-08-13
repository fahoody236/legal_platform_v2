import { pgTable, text, serial, timestamp, integer, real, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const contractsTable = pgTable("contracts", {
  id: serial("id").primaryKey(),
  contractNumber: text("contract_number").notNull().unique(),
  title: text("title").notNull(),
  clientName: text("client_name").notNull(),
  caseId: integer("case_id"),
  status: text("status").notNull().default("draft"), // active | finished | cancelled | draft
  contractType: text("contract_type").notNull(),
  totalValue: real("total_value"),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }),
  description: text("description"),
  responsibleLawyerId: integer("responsible_lawyer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contractPaymentsTable = pgTable("contract_payments", {
  id: serial("id").primaryKey(),
  contractId: integer("contract_id").notNull(),
  amount: real("amount").notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  paidDate: date("paid_date", { mode: "string" }),
  status: text("status").notNull().default("pending"), // pending | paid | overdue
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertContractSchema = createInsertSchema(contractsTable).omit({ id: true, createdAt: true });
export type InsertContract = z.infer<typeof insertContractSchema>;
export type Contract = typeof contractsTable.$inferSelect;
export type ContractPayment = typeof contractPaymentsTable.$inferSelect;

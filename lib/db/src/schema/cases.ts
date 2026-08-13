import { pgTable, text, serial, timestamp, integer, real, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const casesTable = pgTable("cases", {
  id: serial("id").primaryKey(),
  caseNumber: text("case_number").notNull().unique(),
  title: text("title").notNull(),
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email"),
  clientPhone: text("client_phone"),
  caseType: text("case_type").notNull(),
  status: text("status").notNull().default("open"), // open | active | on_hold | closed
  jurisdiction: text("jurisdiction").notNull(),
  court: text("court"),
  opposingParty: text("opposing_party"),
  opposingCounsel: text("opposing_counsel"),
  assignedLawyerId: integer("assigned_lawyer_id"),
  courtDate: date("court_date", { mode: "string" }),
  statuteDeadline: date("statute_deadline", { mode: "string" }),
  description: text("description"),
  retainerAmount: real("retainer_amount"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCaseSchema = createInsertSchema(casesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCase = z.infer<typeof insertCaseSchema>;
export type Case = typeof casesTable.$inferSelect;

import { pgTable, serial, text, integer, timestamp, varchar } from "drizzle-orm/pg-core";

export const chatChannelsTable = pgTable("chat_channels", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  type: varchar("type", { length: 20 }).notNull().default("general"), // general | case | direct
  caseId: integer("case_id"),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id").notNull(),
  senderId: integer("sender_id"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

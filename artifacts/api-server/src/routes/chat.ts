import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db, chatChannelsTable, chatMessagesTable, usersTable, casesTable } from "@workspace/db";
import { subscribe, unsubscribe, broadcast } from "../lib/chat-bus";

const router: IRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────

async function enrichMessages(messages: { id: number; channelId: number; senderId: number | null; content: string; createdAt: Date }[]) {
  const userIds = [...new Set(messages.map(m => m.senderId).filter(Boolean) as number[])];
  const users = userIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(
        userIds.length === 1
          ? eq(usersTable.id, userIds[0])
          : eq(usersTable.id, userIds[0]) // drizzle inList workaround below
      )
    : [];
  // Build name map
  const nameMap = new Map<number, string>();
  for (const id of userIds) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
    if (u) nameMap.set(id, u.name);
  }
  return messages.map(m => ({
    ...m,
    senderName: m.senderId ? (nameMap.get(m.senderId) ?? "Unknown") : "System",
  }));
}

// ── List channels ──────────────────────────────────────────────────

router.get("/chat/channels", async (_req, res): Promise<void> => {
  const channels = await db
    .select({
      id: chatChannelsTable.id,
      name: chatChannelsTable.name,
      description: chatChannelsTable.description,
      type: chatChannelsTable.type,
      caseId: chatChannelsTable.caseId,
      caseName: casesTable.title,
      createdById: chatChannelsTable.createdById,
      createdAt: chatChannelsTable.createdAt,
    })
    .from(chatChannelsTable)
    .leftJoin(casesTable, eq(chatChannelsTable.caseId, casesTable.id))
    .orderBy(chatChannelsTable.createdAt);
  res.json(channels);
});

// ── Create channel ─────────────────────────────────────────────────

const CreateChannelBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  type: z.enum(["general", "case", "direct"]).default("general"),
  caseId: z.number().int().optional(),
  createdById: z.number().int().optional(),
});

router.post("/chat/channels", async (req, res): Promise<void> => {
  const parsed = CreateChannelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [channel] = await db.insert(chatChannelsTable).values(parsed.data).returning();
  res.status(201).json(channel);
});

// ── List messages ──────────────────────────────────────────────────

router.get("/chat/channels/:id/messages", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 100);
  const raw = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.channelId, id))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(limit);

  // Return oldest-first for display
  const enriched = await enrichMessages(raw.reverse());
  res.json(enriched);
});

// ── Send message ───────────────────────────────────────────────────

const SendMessageBody = z.object({
  content: z.string().min(1).max(4000),
  senderId: z.number().int().optional(),
});

router.post("/chat/channels/:id/messages", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [msg] = await db
    .insert(chatMessagesTable)
    .values({ channelId: id, ...parsed.data })
    .returning();

  let senderName = "Unknown";
  if (msg.senderId) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, msg.senderId));
    if (u) senderName = u.name;
  }

  const enriched = { ...msg, senderName };
  broadcast(id, enriched);
  res.status(201).json(enriched);
});

// ── SSE stream ─────────────────────────────────────────────────────

router.get("/chat/channels/:id/stream", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Initial heartbeat so the client knows it's connected
  res.write(": connected\n\n");

  subscribe(id, res);

  // Heartbeat every 25 s to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { /* ignore */ }
  }, 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe(id, res);
  });
});

export default router;

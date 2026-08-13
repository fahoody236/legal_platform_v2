import { Router, type IRouter } from "express";
import { eq, or, ilike } from "drizzle-orm";
import { db, knowledgeBaseTable, aiSettingsTable, documentsTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import multer from "multer";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ── Helpers ────────────────────────────────────────────────────────────────

async function getOrCreateSettings() {
  const rows = await db.select().from(aiSettingsTable).limit(1);
  if (rows.length > 0) return rows[0];
  const [created] = await db
    .insert(aiSettingsTable)
    .values({})
    .returning();
  return created;
}

async function getRelevantContext(question: string, maxEntries = 5): Promise<string> {
  const words = question
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5);

  let entries: typeof knowledgeBaseTable.$inferSelect[] = [];

  if (words.length > 0) {
    // Search by keywords
    const conditions = words.map((w) => ilike(knowledgeBaseTable.content, `%${w}%`));
    entries = await db
      .select()
      .from(knowledgeBaseTable)
      .where(or(...conditions))
      .limit(maxEntries);
  }

  // If not enough, fill with most recent
  if (entries.length < maxEntries) {
    const recent = await db
      .select()
      .from(knowledgeBaseTable)
      .limit(maxEntries - entries.length);
    const existing = new Set(entries.map((e) => e.id));
    for (const r of recent) {
      if (!existing.has(r.id)) entries.push(r);
    }
  }

  if (entries.length === 0) return "";

  const sections = entries
    .map(
      (e) =>
        `### ${e.title}\n${e.content.slice(0, 2000)}${e.content.length > 2000 ? "\n[…truncated]" : ""}`,
    )
    .join("\n\n");
  return `\n\n## Firm Knowledge Base\n\n${sections}\n`;
}

// ── AI Settings ────────────────────────────────────────────────────────────

router.get("/ai/settings", async (_req, res) => {
  const settings = await getOrCreateSettings();
  res.json(settings);
});

router.put("/ai/settings", async (req, res): Promise<void> => {
  const { model, systemPrompt } = req.body as { model?: string; systemPrompt?: string };
  const existing = await db.select().from(aiSettingsTable).limit(1);

  if (existing.length === 0) {
    const [created] = await db
      .insert(aiSettingsTable)
      .values({ model: model ?? "gpt-5.6-terra", systemPrompt: systemPrompt ?? "" })
      .returning();
    res.json(created);
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (model !== undefined) updates.model = model;
  if (systemPrompt !== undefined) updates.systemPrompt = systemPrompt;

  const [updated] = await db
    .update(aiSettingsTable)
    .set(updates)
    .where(eq(aiSettingsTable.id, existing[0].id))
    .returning();
  res.json(updated);
});

// ── Knowledge Base ─────────────────────────────────────────────────────────

router.get("/ai/knowledge-base", async (_req, res) => {
  const entries = await db
    .select()
    .from(knowledgeBaseTable)
    .orderBy(knowledgeBaseTable.createdAt);
  res.json(entries);
});

router.post("/ai/knowledge-base", async (req, res) => {
  const { title, content, sourceType, sourceDocumentId, fileName, fileSize } = req.body as {
    title: string;
    content: string;
    sourceType?: string;
    sourceDocumentId?: number;
    fileName?: string;
    fileSize?: number;
  };

  const [entry] = await db
    .insert(knowledgeBaseTable)
    .values({
      title,
      content,
      sourceType: sourceType ?? "paste",
      sourceDocumentId: sourceDocumentId ?? null,
      fileName: fileName ?? null,
      fileSize: fileSize ?? null,
    })
    .returning();

  res.status(201).json(entry);
});

router.delete("/ai/knowledge-base/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, id));
  res.status(204).end();
});

// Import from existing document
router.post("/ai/knowledge-base/import-document/:documentId", async (req, res): Promise<void> => {
  const documentId = Number(req.params.documentId);
  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, documentId));

  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const content = doc.description
    ? `${doc.description}\n\nTags: ${doc.tags ?? ""}`
    : `Document: ${doc.title}\nTags: ${doc.tags ?? ""}`;

  const [entry] = await db
    .insert(knowledgeBaseTable)
    .values({
      title: doc.title,
      content,
      sourceType: "document",
      sourceDocumentId: documentId,
      fileName: null,
      fileSize: null,
    })
    .returning();

  res.status(201).json(entry);
});

// File upload (PDF via multer, text handled client-side)
router.post("/ai/knowledge-base/upload", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const { originalname, buffer, mimetype } = req.file;
  let textContent = "";

  if (mimetype === "application/pdf" || originalname.endsWith(".pdf")) {
    try {
      // Dynamic import to handle CJS module
      const pdfParse = (await import("pdf-parse")).default;
      const data = await pdfParse(buffer);
      textContent = data.text;
    } catch {
      res.status(422).json({ error: "Could not parse PDF" });
      return;
    }
  } else {
    textContent = buffer.toString("utf-8");
  }

  if (!textContent.trim()) {
    res.status(422).json({ error: "No text could be extracted from the file" });
    return;
  }

  const [entry] = await db
    .insert(knowledgeBaseTable)
    .values({
      title: originalname,
      content: textContent,
      sourceType: "upload",
      fileName: originalname,
      fileSize: buffer.length,
    })
    .returning();

  res.status(201).json(entry);
});

// ── AI Ask (SSE streaming) ─────────────────────────────────────────────────

router.post("/ai/ask", async (req, res) => {
  const { question, history = [] } = req.body as {
    question: string;
    history?: Array<{ role: string; content: string }>;
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const settings = await getOrCreateSettings();
    const context = await getRelevantContext(question);

    const systemMessage =
      settings.systemPrompt +
      (context
        ? `\n\nUse the following firm knowledge base when relevant:${context}`
        : "\n\nNo firm-specific documents have been uploaded to the knowledge base yet.");

    const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemMessage },
      ...history
        .slice(-8)
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user", content: question },
    ];

    const stream = await openai.chat.completions.create({
      model: settings.model,
      max_completion_tokens: 8192,
      messages: chatMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: "AI request failed" })}\n\n`);
    res.end();
  }
});

// ── AI Generate Draft ──────────────────────────────────────────────────────

router.post("/ai/generate-draft", async (req, res) => {
  const { draftType, caseId, instructions } = req.body as {
    draftType: string;
    caseId?: number;
    instructions: string;
  };

  const settings = await getOrCreateSettings();
  const context = await getRelevantContext(instructions);

  let caseContext = "";
  if (caseId) {
    const { casesTable } = await import("@workspace/db");
    const [caseRow] = await db
      .select()
      .from(casesTable)
      .where(eq(casesTable.id, caseId));
    if (caseRow) {
      caseContext = `\n\nCase: ${caseRow.title}\nClient: ${caseRow.clientName}\nType: ${caseRow.caseType}\nDescription: ${caseRow.description ?? ""}`;
    }
  }

  const systemPrompt =
    settings.systemPrompt +
    (context ? `\n\nKnowledge base:${context}` : "") +
    "\n\nYou are drafting a legal document. Return ONLY the document text — no meta-commentary, no markdown wrapper, just the document content.";

  const userPrompt = `Draft a ${draftType.replace(/_/g, " ")} with the following instructions:\n${instructions}${caseContext}`;

  const response = await openai.chat.completions.create({
    model: settings.model,
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "";
  const title = `AI ${draftType.replace(/_/g, " ")} — ${new Date().toLocaleDateString()}`;

  res.json({ title, content });
});

export default router;

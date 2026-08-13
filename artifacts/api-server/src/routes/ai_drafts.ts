import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, aiDraftsTable, casesTable, usersTable } from "@workspace/db";
import {
  ListAiDraftsQueryParams,
  ListAiDraftsResponse,
  CreateAiDraftBody,
  CreateAiDraftResponse,
  GetAiDraftParams,
  GetAiDraftResponse,
  ApproveAiDraftParams,
  ApproveAiDraftBody,
  ApproveAiDraftResponse,
  RejectAiDraftParams,
  RejectAiDraftBody,
  RejectAiDraftResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const draftSelect = {
  id: aiDraftsTable.id,
  title: aiDraftsTable.title,
  draftType: aiDraftsTable.draftType,
  status: aiDraftsTable.status,
  content: aiDraftsTable.content,
  caseId: aiDraftsTable.caseId,
  caseName: casesTable.title,
  createdById: aiDraftsTable.createdById,
  reviewedById: aiDraftsTable.reviewedById,
  reviewedAt: aiDraftsTable.reviewedAt,
  reviewNotes: aiDraftsTable.reviewNotes,
  editsMadeBeforeApproval: aiDraftsTable.editsMadeBeforeApproval,
  createdAt: aiDraftsTable.createdAt,
};

router.get("/ai-drafts", async (req, res): Promise<void> => {
  const params = ListAiDraftsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  let query = db
    .select(draftSelect)
    .from(aiDraftsTable)
    .leftJoin(casesTable, eq(aiDraftsTable.caseId, casesTable.id))
    .$dynamic();

  const conditions = [];
  if (params.data.status) conditions.push(eq(aiDraftsTable.status, params.data.status));
  if (params.data.caseId) conditions.push(eq(aiDraftsTable.caseId, params.data.caseId));
  if (conditions.length > 0) query = query.where(and(...conditions));

  const drafts = await query.orderBy(aiDraftsTable.createdAt);
  // Fetch user names separately for created/reviewed by
  const result = await Promise.all(
    drafts.map(async (d) => {
      let createdByName: string | null = null;
      let reviewedByName: string | null = null;
      if (d.createdById) {
        const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, d.createdById));
        createdByName = u?.name ?? null;
      }
      if (d.reviewedById) {
        const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, d.reviewedById));
        reviewedByName = u?.name ?? null;
      }
      return { ...d, createdByName, reviewedByName };
    })
  );
  res.json(ListAiDraftsResponse.parse(result));
});

router.post("/ai-drafts", async (req, res): Promise<void> => {
  const parsed = CreateAiDraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [draft] = await db.insert(aiDraftsTable).values(parsed.data).returning();
  res.status(201).json(CreateAiDraftResponse.parse({ ...draft, caseName: null, createdByName: null, reviewedByName: null }));
});

router.get("/ai-drafts/:id", async (req, res): Promise<void> => {
  const params = GetAiDraftParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [draft] = await db
    .select(draftSelect)
    .from(aiDraftsTable)
    .leftJoin(casesTable, eq(aiDraftsTable.caseId, casesTable.id))
    .where(eq(aiDraftsTable.id, params.data.id));
  if (!draft) {
    res.status(404).json({ error: "AI draft not found" });
    return;
  }
  let createdByName: string | null = null;
  let reviewedByName: string | null = null;
  if (draft.createdById) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, draft.createdById));
    createdByName = u?.name ?? null;
  }
  if (draft.reviewedById) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, draft.reviewedById));
    reviewedByName = u?.name ?? null;
  }
  res.json(GetAiDraftResponse.parse({ ...draft, createdByName, reviewedByName }));
});

router.patch("/ai-drafts/:id/approve", async (req, res): Promise<void> => {
  const params = ApproveAiDraftParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ApproveAiDraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(aiDraftsTable)
    .set({
      status: "approved",
      reviewedById: parsed.data.reviewedById,
      reviewedAt: new Date(),
      reviewNotes: parsed.data.reviewNotes,
      editsMadeBeforeApproval: parsed.data.editsMadeBeforeApproval,
    })
    .where(eq(aiDraftsTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Draft not found" });
    return;
  }
  res.json(ApproveAiDraftResponse.parse({ ...updated, caseName: null, createdByName: null, reviewedByName: null }));
});

router.patch("/ai-drafts/:id/reject", async (req, res): Promise<void> => {
  const params = RejectAiDraftParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = RejectAiDraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(aiDraftsTable)
    .set({
      status: "rejected",
      reviewedById: parsed.data.reviewedById,
      reviewedAt: new Date(),
      reviewNotes: parsed.data.reviewNotes,
    })
    .where(eq(aiDraftsTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Draft not found" });
    return;
  }
  res.json(RejectAiDraftResponse.parse({ ...updated, caseName: null, createdByName: null, reviewedByName: null }));
});

export default router;

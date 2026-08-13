import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, documentsTable, documentVersionsTable, casesTable, usersTable } from "@workspace/db";
import {
  ListCaseDocumentsParams,
  ListCaseDocumentsResponse,
  CreateDocumentParams,
  CreateDocumentBody,
  CreateDocumentResponse,
  ListAllDocumentsResponse,
  GetDocumentParams,
  GetDocumentResponse,
  UpdateDocumentParams,
  UpdateDocumentBody,
  UpdateDocumentResponse,
  DeleteDocumentParams,
  GetDocumentVersionsParams,
  GetDocumentVersionsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const enrichDocument = async (id: number) => {
  const [doc] = await db
    .select({
      id: documentsTable.id,
      caseId: documentsTable.caseId,
      caseName: casesTable.title,
      title: documentsTable.title,
      description: documentsTable.description,
      fileType: documentsTable.fileType,
      filePath: documentsTable.filePath,
      status: documentsTable.status,
      version: documentsTable.version,
      uploadedBy: usersTable.name,
      uploadedById: documentsTable.uploadedById,
      tags: documentsTable.tags,
      createdAt: documentsTable.createdAt,
      updatedAt: documentsTable.updatedAt,
    })
    .from(documentsTable)
    .leftJoin(casesTable, eq(documentsTable.caseId, casesTable.id))
    .leftJoin(usersTable, eq(documentsTable.uploadedById, usersTable.id))
    .where(eq(documentsTable.id, id));
  return doc;
};

router.get("/cases/:caseId/documents", async (req, res): Promise<void> => {
  const params = ListCaseDocumentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const docs = await db
    .select({
      id: documentsTable.id,
      caseId: documentsTable.caseId,
      caseName: casesTable.title,
      title: documentsTable.title,
      description: documentsTable.description,
      fileType: documentsTable.fileType,
      filePath: documentsTable.filePath,
      status: documentsTable.status,
      version: documentsTable.version,
      uploadedBy: usersTable.name,
      uploadedById: documentsTable.uploadedById,
      tags: documentsTable.tags,
      createdAt: documentsTable.createdAt,
      updatedAt: documentsTable.updatedAt,
    })
    .from(documentsTable)
    .leftJoin(casesTable, eq(documentsTable.caseId, casesTable.id))
    .leftJoin(usersTable, eq(documentsTable.uploadedById, usersTable.id))
    .where(eq(documentsTable.caseId, params.data.caseId))
    .orderBy(documentsTable.createdAt);
  res.json(ListCaseDocumentsResponse.parse(docs));
});

router.post("/cases/:caseId/documents", async (req, res): Promise<void> => {
  const params = CreateDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [doc] = await db
    .insert(documentsTable)
    .values({ caseId: params.data.caseId, ...parsed.data })
    .returning();
  const enriched = await enrichDocument(doc.id);
  res.status(201).json(CreateDocumentResponse.parse({ ...enriched, uploadedBy: enriched?.uploadedBy ?? "Unknown" }));
});

router.get("/documents", async (_req, res): Promise<void> => {
  const docs = await db
    .select({
      id: documentsTable.id,
      caseId: documentsTable.caseId,
      caseName: casesTable.title,
      title: documentsTable.title,
      description: documentsTable.description,
      fileType: documentsTable.fileType,
      filePath: documentsTable.filePath,
      status: documentsTable.status,
      version: documentsTable.version,
      uploadedBy: usersTable.name,
      uploadedById: documentsTable.uploadedById,
      tags: documentsTable.tags,
      createdAt: documentsTable.createdAt,
      updatedAt: documentsTable.updatedAt,
    })
    .from(documentsTable)
    .leftJoin(casesTable, eq(documentsTable.caseId, casesTable.id))
    .leftJoin(usersTable, eq(documentsTable.uploadedById, usersTable.id))
    .orderBy(documentsTable.createdAt);
  res.json(ListAllDocumentsResponse.parse(docs));
});

router.get("/documents/:id", async (req, res): Promise<void> => {
  const params = GetDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const enriched = await enrichDocument(params.data.id);
  if (!enriched) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(GetDocumentResponse.parse({ ...enriched, uploadedBy: enriched.uploadedBy ?? "Unknown" }));
});

router.patch("/documents/:id", async (req, res): Promise<void> => {
  const params = UpdateDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Create version record before update
  const [existing] = await db.select().from(documentsTable).where(eq(documentsTable.id, params.data.id));
  if (existing) {
    await db.insert(documentVersionsTable).values({
      documentId: existing.id,
      version: existing.version,
      changeNote: "Updated document",
    });
    await db
      .update(documentsTable)
      .set({ ...parsed.data, version: existing.version + 1 })
      .where(eq(documentsTable.id, params.data.id));
  }
  const enriched = await enrichDocument(params.data.id);
  if (!enriched) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(UpdateDocumentResponse.parse({ ...enriched, uploadedBy: enriched.uploadedBy ?? "Unknown" }));
});

router.delete("/documents/:id", async (req, res): Promise<void> => {
  const params = DeleteDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(documentsTable).where(eq(documentsTable.id, params.data.id));
  res.sendStatus(204);
});

router.get("/documents/:id/versions", async (req, res): Promise<void> => {
  const params = GetDocumentVersionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const versions = await db
    .select({
      id: documentVersionsTable.id,
      documentId: documentVersionsTable.documentId,
      version: documentVersionsTable.version,
      editedBy: usersTable.name,
      editedAt: documentVersionsTable.editedAt,
      changeNote: documentVersionsTable.changeNote,
    })
    .from(documentVersionsTable)
    .leftJoin(usersTable, eq(documentVersionsTable.editedById, usersTable.id))
    .where(eq(documentVersionsTable.documentId, params.data.id))
    .orderBy(documentVersionsTable.version);
  res.json(GetDocumentVersionsResponse.parse(versions));
});

export default router;

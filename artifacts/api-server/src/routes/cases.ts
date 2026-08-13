import { Router, type IRouter } from "express";
import { eq, ilike, or, and } from "drizzle-orm";
import { db, casesTable, caseActivitiesTable, usersTable } from "@workspace/db";
import { datesToStrings } from "../lib/date-utils";
import {
  ListCasesResponse,
  ListCasesQueryParams,
  CreateCaseBody,
  CreateCaseResponse,
  CheckConflictQueryParams,
  CheckConflictResponse,
  GetCaseParams,
  GetCaseResponse,
  UpdateCaseParams,
  UpdateCaseBody,
  UpdateCaseResponse,
  DeleteCaseParams,
  GetCaseTimelineParams,
  GetCaseTimelineResponse,
  AddCaseActivityParams,
  AddCaseActivityBody,
  AddCaseActivityResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/cases", async (req, res): Promise<void> => {
  const params = ListCasesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  let query = db
    .select({
      id: casesTable.id,
      caseNumber: casesTable.caseNumber,
      title: casesTable.title,
      clientName: casesTable.clientName,
      clientEmail: casesTable.clientEmail,
      clientPhone: casesTable.clientPhone,
      caseType: casesTable.caseType,
      status: casesTable.status,
      jurisdiction: casesTable.jurisdiction,
      court: casesTable.court,
      opposingParty: casesTable.opposingParty,
      opposingCounsel: casesTable.opposingCounsel,
      assignedLawyerId: casesTable.assignedLawyerId,
      assignedLawyerName: usersTable.name,
      courtDate: casesTable.courtDate,
      statuteDeadline: casesTable.statuteDeadline,
      description: casesTable.description,
      retainerAmount: casesTable.retainerAmount,
      createdAt: casesTable.createdAt,
      updatedAt: casesTable.updatedAt,
    })
    .from(casesTable)
    .leftJoin(usersTable, eq(casesTable.assignedLawyerId, usersTable.id))
    .$dynamic();

  const conditions = [];
  if (params.data.status) {
    conditions.push(eq(casesTable.status, params.data.status));
  }
  if (params.data.search) {
    const s = `%${params.data.search}%`;
    conditions.push(
      or(
        ilike(casesTable.title, s),
        ilike(casesTable.clientName, s),
        ilike(casesTable.caseNumber, s)
      )!
    );
  }
  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const cases = await query.orderBy(casesTable.createdAt);
  res.json(ListCasesResponse.parse(cases));
});

router.get("/cases/conflict-check", async (req, res): Promise<void> => {
  const params = CheckConflictQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const q = `%${params.data.query}%`;
  const matches: { caseId: number; caseTitle: string; matchType: string; matchedValue: string }[] = [];

  const clientMatches = await db
    .select({ id: casesTable.id, title: casesTable.title, clientName: casesTable.clientName })
    .from(casesTable)
    .where(ilike(casesTable.clientName, q));
  for (const c of clientMatches) {
    matches.push({ caseId: c.id, caseTitle: c.title, matchType: "client", matchedValue: c.clientName });
  }

  const opposingMatches = await db
    .select({ id: casesTable.id, title: casesTable.title, opposingParty: casesTable.opposingParty })
    .from(casesTable)
    .where(ilike(casesTable.opposingParty, q));
  for (const c of opposingMatches) {
    if (c.opposingParty) {
      matches.push({ caseId: c.id, caseTitle: c.title, matchType: "opposing_party", matchedValue: c.opposingParty });
    }
  }

  res.json(CheckConflictResponse.parse({ hasConflict: matches.length > 0, matches }));
});

router.post("/cases", async (req, res): Promise<void> => {
  const parsed = CreateCaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Auto-generate case number
  const count = await db.select().from(casesTable);
  const caseNumber = `ALH-${String(count.length + 1).padStart(4, "0")}`;
  const [newCase] = await db
    .insert(casesTable)
    .values(datesToStrings({ ...parsed.data, caseNumber }))
    .returning();
  res.status(201).json(CreateCaseResponse.parse({ ...newCase, assignedLawyerName: null }));
});

router.get("/cases/:id", async (req, res): Promise<void> => {
  const params = GetCaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [caseRow] = await db
    .select({
      id: casesTable.id,
      caseNumber: casesTable.caseNumber,
      title: casesTable.title,
      clientName: casesTable.clientName,
      clientEmail: casesTable.clientEmail,
      clientPhone: casesTable.clientPhone,
      caseType: casesTable.caseType,
      status: casesTable.status,
      jurisdiction: casesTable.jurisdiction,
      court: casesTable.court,
      opposingParty: casesTable.opposingParty,
      opposingCounsel: casesTable.opposingCounsel,
      assignedLawyerId: casesTable.assignedLawyerId,
      assignedLawyerName: usersTable.name,
      courtDate: casesTable.courtDate,
      statuteDeadline: casesTable.statuteDeadline,
      description: casesTable.description,
      retainerAmount: casesTable.retainerAmount,
      createdAt: casesTable.createdAt,
      updatedAt: casesTable.updatedAt,
    })
    .from(casesTable)
    .leftJoin(usersTable, eq(casesTable.assignedLawyerId, usersTable.id))
    .where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  res.json(GetCaseResponse.parse(caseRow));
});

router.patch("/cases/:id", async (req, res): Promise<void> => {
  const params = UpdateCaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(casesTable)
    .set(datesToStrings(parsed.data))
    .where(eq(casesTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  res.json(UpdateCaseResponse.parse({ ...updated, assignedLawyerName: null }));
});

router.delete("/cases/:id", async (req, res): Promise<void> => {
  const params = DeleteCaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(casesTable).where(eq(casesTable.id, params.data.id));
  res.sendStatus(204);
});

router.get("/cases/:id/timeline", async (req, res): Promise<void> => {
  const params = GetCaseTimelineParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const activities = await db
    .select({
      id: caseActivitiesTable.id,
      caseId: caseActivitiesTable.caseId,
      activityType: caseActivitiesTable.activityType,
      description: caseActivitiesTable.description,
      performedById: caseActivitiesTable.performedById,
      performedBy: usersTable.name,
      caseTitle: casesTable.title,
      createdAt: caseActivitiesTable.createdAt,
    })
    .from(caseActivitiesTable)
    .leftJoin(usersTable, eq(caseActivitiesTable.performedById, usersTable.id))
    .leftJoin(casesTable, eq(caseActivitiesTable.caseId, casesTable.id))
    .where(eq(caseActivitiesTable.caseId, params.data.id))
    .orderBy(caseActivitiesTable.createdAt);
  res.json(GetCaseTimelineResponse.parse(activities));
});

router.post("/cases/:id/timeline", async (req, res): Promise<void> => {
  const params = AddCaseActivityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = AddCaseActivityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [activity] = await db
    .insert(caseActivitiesTable)
    .values({ caseId: params.data.id, ...parsed.data })
    .returning();
  res.status(201).json(AddCaseActivityResponse.parse({ ...activity, performedBy: null, caseTitle: null }));
});

export default router;

import { Router, type IRouter } from "express";
import { eq, ilike, and } from "drizzle-orm";
import { db, contractsTable, contractPaymentsTable, casesTable, usersTable } from "@workspace/db";
import { datesToStrings } from "../lib/date-utils";
import {
  ListContractsQueryParams,
  ListContractsResponse,
  CreateContractBody,
  CreateContractResponse,
  GetContractParams,
  GetContractResponse,
  UpdateContractParams,
  UpdateContractBody,
  UpdateContractResponse,
  DeleteContractParams,
  ListContractPaymentsParams,
  ListContractPaymentsResponse,
  CreateContractPaymentParams,
  CreateContractPaymentBody,
  CreateContractPaymentResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const contractSelect = {
  id: contractsTable.id,
  contractNumber: contractsTable.contractNumber,
  title: contractsTable.title,
  clientName: contractsTable.clientName,
  caseId: contractsTable.caseId,
  caseName: casesTable.title,
  status: contractsTable.status,
  contractType: contractsTable.contractType,
  totalValue: contractsTable.totalValue,
  startDate: contractsTable.startDate,
  endDate: contractsTable.endDate,
  description: contractsTable.description,
  responsibleLawyerId: contractsTable.responsibleLawyerId,
  responsibleLawyerName: usersTable.name,
  createdAt: contractsTable.createdAt,
};

router.get("/contracts", async (req, res): Promise<void> => {
  const params = ListContractsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  let query = db
    .select(contractSelect)
    .from(contractsTable)
    .leftJoin(casesTable, eq(contractsTable.caseId, casesTable.id))
    .leftJoin(usersTable, eq(contractsTable.responsibleLawyerId, usersTable.id))
    .$dynamic();

  const conditions = [];
  if (params.data.status) conditions.push(eq(contractsTable.status, params.data.status));
  if (params.data.search) {
    const s = `%${params.data.search}%`;
    conditions.push(ilike(contractsTable.title, s));
  }
  if (conditions.length > 0) query = query.where(and(...conditions));

  const contracts = await query.orderBy(contractsTable.createdAt);
  // Calculate nextPaymentDate from payments
  res.json(ListContractsResponse.parse(contracts.map(c => ({ ...c, nextPaymentDate: null }))));
});

router.post("/contracts", async (req, res): Promise<void> => {
  const parsed = CreateContractBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const count = await db.select().from(contractsTable);
  const contractNumber = `CTR-${String(count.length + 1).padStart(4, "0")}`;
  const [contract] = await db.insert(contractsTable).values(datesToStrings({ ...parsed.data, contractNumber })).returning();
  res.status(201).json(CreateContractResponse.parse({ ...contract, caseName: null, responsibleLawyerName: null, nextPaymentDate: null }));
});

router.get("/contracts/:id", async (req, res): Promise<void> => {
  const params = GetContractParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [contract] = await db
    .select(contractSelect)
    .from(contractsTable)
    .leftJoin(casesTable, eq(contractsTable.caseId, casesTable.id))
    .leftJoin(usersTable, eq(contractsTable.responsibleLawyerId, usersTable.id))
    .where(eq(contractsTable.id, params.data.id));
  if (!contract) {
    res.status(404).json({ error: "Contract not found" });
    return;
  }
  // Get next payment
  const [nextPayment] = await db
    .select()
    .from(contractPaymentsTable)
    .where(and(eq(contractPaymentsTable.contractId, params.data.id), eq(contractPaymentsTable.status, "pending")))
    .orderBy(contractPaymentsTable.dueDate)
    .limit(1);
  res.json(GetContractResponse.parse({ ...contract, nextPaymentDate: nextPayment?.dueDate ?? null }));
});

router.patch("/contracts/:id", async (req, res): Promise<void> => {
  const params = UpdateContractParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateContractBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(contractsTable)
    .set(datesToStrings(parsed.data))
    .where(eq(contractsTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Contract not found" });
    return;
  }
  res.json(UpdateContractResponse.parse({ ...updated, caseName: null, responsibleLawyerName: null, nextPaymentDate: null }));
});

router.delete("/contracts/:id", async (req, res): Promise<void> => {
  const params = DeleteContractParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(contractsTable).where(eq(contractsTable.id, params.data.id));
  res.sendStatus(204);
});

router.get("/contracts/:id/payment-schedules", async (req, res): Promise<void> => {
  const params = ListContractPaymentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const payments = await db
    .select()
    .from(contractPaymentsTable)
    .where(eq(contractPaymentsTable.contractId, params.data.id))
    .orderBy(contractPaymentsTable.dueDate);
  res.json(ListContractPaymentsResponse.parse(payments));
});

router.post("/contracts/:id/payment-schedules", async (req, res): Promise<void> => {
  const params = CreateContractPaymentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateContractPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [payment] = await db
    .insert(contractPaymentsTable)
    .values(datesToStrings({ contractId: params.data.id, ...parsed.data }))
    .returning();
  res.status(201).json(CreateContractPaymentResponse.parse(payment));
});

export default router;

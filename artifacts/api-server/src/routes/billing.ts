import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, timeEntriesTable, invoicesTable, expensesTable, casesTable, usersTable } from "@workspace/db";
import { datesToStrings } from "../lib/date-utils";
import {
  ListTimeEntriesQueryParams,
  ListTimeEntriesResponse,
  CreateTimeEntryBody,
  CreateTimeEntryResponse,
  GetTimeSummaryResponse,
  GetTimeEntryParams,
  GetTimeEntryResponse,
  UpdateTimeEntryParams,
  UpdateTimeEntryBody,
  UpdateTimeEntryResponse,
  DeleteTimeEntryParams,
  ListInvoicesQueryParams,
  ListInvoicesResponse,
  CreateInvoiceBody,
  CreateInvoiceResponse,
  GetInvoiceParams,
  GetInvoiceResponse,
  UpdateInvoiceParams,
  UpdateInvoiceBody,
  UpdateInvoiceResponse,
  DeleteInvoiceParams,
  ListExpensesQueryParams,
  ListExpensesResponse,
  CreateExpenseBody,
  CreateExpenseResponse,
  UpdateExpenseParams,
  UpdateExpenseBody,
  UpdateExpenseResponse,
  DeleteExpenseParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ── Time Entries ────────────────────────────────────────────────────

router.get("/time-entries", async (req, res): Promise<void> => {
  const params = ListTimeEntriesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  let query = db
    .select({
      id: timeEntriesTable.id,
      caseId: timeEntriesTable.caseId,
      caseName: casesTable.title,
      lawyerId: timeEntriesTable.lawyerId,
      lawyerName: usersTable.name,
      hours: timeEntriesTable.hours,
      hourlyRate: timeEntriesTable.hourlyRate,
      totalAmount: sql<number>`${timeEntriesTable.hours} * ${timeEntriesTable.hourlyRate}`,
      date: timeEntriesTable.date,
      description: timeEntriesTable.description,
      isBillable: timeEntriesTable.isBillable,
      invoiced: timeEntriesTable.invoiced,
      createdAt: timeEntriesTable.createdAt,
    })
    .from(timeEntriesTable)
    .leftJoin(casesTable, eq(timeEntriesTable.caseId, casesTable.id))
    .leftJoin(usersTable, eq(timeEntriesTable.lawyerId, usersTable.id))
    .$dynamic();

  const conditions = [];
  if (params.data.caseId) {
    conditions.push(eq(timeEntriesTable.caseId, params.data.caseId));
  }
  if (params.data.lawyerId) {
    conditions.push(eq(timeEntriesTable.lawyerId, params.data.lawyerId));
  }
  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const entries = await query.orderBy(timeEntriesTable.date);
  res.json(ListTimeEntriesResponse.parse(entries));
});

router.get("/time-entries/summary", async (_req, res): Promise<void> => {
  const entries = await db
    .select({
      lawyerId: timeEntriesTable.lawyerId,
      lawyerName: usersTable.name,
      hours: timeEntriesTable.hours,
      hourlyRate: timeEntriesTable.hourlyRate,
      isBillable: timeEntriesTable.isBillable,
      invoiced: timeEntriesTable.invoiced,
    })
    .from(timeEntriesTable)
    .leftJoin(usersTable, eq(timeEntriesTable.lawyerId, usersTable.id));

  const summaryMap = new Map<number, { lawyerId: number; lawyerName: string; totalHours: number; billableHours: number; totalAmount: number; unbilledAmount: number }>();
  for (const e of entries) {
    if (!e.lawyerId) continue;
    const existing = summaryMap.get(e.lawyerId) ?? { lawyerId: e.lawyerId, lawyerName: e.lawyerName ?? "Unknown", totalHours: 0, billableHours: 0, totalAmount: 0, unbilledAmount: 0 };
    existing.totalHours += e.hours;
    if (e.isBillable) {
      existing.billableHours += e.hours;
      existing.totalAmount += e.hours * e.hourlyRate;
      if (!e.invoiced) existing.unbilledAmount += e.hours * e.hourlyRate;
    }
    summaryMap.set(e.lawyerId, existing);
  }

  res.json(GetTimeSummaryResponse.parse(Array.from(summaryMap.values())));
});

router.post("/time-entries", async (req, res): Promise<void> => {
  const parsed = CreateTimeEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [entry] = await db.insert(timeEntriesTable).values(datesToStrings(parsed.data)).returning();
  res.status(201).json(CreateTimeEntryResponse.parse({ ...entry, caseName: null, lawyerName: null, totalAmount: entry.hours * entry.hourlyRate }));
});

router.get("/time-entries/:id", async (req, res): Promise<void> => {
  const params = GetTimeEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [entry] = await db
    .select({
      id: timeEntriesTable.id,
      caseId: timeEntriesTable.caseId,
      caseName: casesTable.title,
      lawyerId: timeEntriesTable.lawyerId,
      lawyerName: usersTable.name,
      hours: timeEntriesTable.hours,
      hourlyRate: timeEntriesTable.hourlyRate,
      totalAmount: sql<number>`${timeEntriesTable.hours} * ${timeEntriesTable.hourlyRate}`,
      date: timeEntriesTable.date,
      description: timeEntriesTable.description,
      isBillable: timeEntriesTable.isBillable,
      invoiced: timeEntriesTable.invoiced,
      createdAt: timeEntriesTable.createdAt,
    })
    .from(timeEntriesTable)
    .leftJoin(casesTable, eq(timeEntriesTable.caseId, casesTable.id))
    .leftJoin(usersTable, eq(timeEntriesTable.lawyerId, usersTable.id))
    .where(eq(timeEntriesTable.id, params.data.id));
  if (!entry) {
    res.status(404).json({ error: "Time entry not found" });
    return;
  }
  res.json(GetTimeEntryResponse.parse(entry));
});

router.patch("/time-entries/:id", async (req, res): Promise<void> => {
  const params = UpdateTimeEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateTimeEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(timeEntriesTable)
    .set(datesToStrings(parsed.data))
    .where(eq(timeEntriesTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Time entry not found" });
    return;
  }
  res.json(UpdateTimeEntryResponse.parse({ ...updated, caseName: null, lawyerName: null, totalAmount: updated.hours * updated.hourlyRate }));
});

router.delete("/time-entries/:id", async (req, res): Promise<void> => {
  const params = DeleteTimeEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(timeEntriesTable).where(eq(timeEntriesTable.id, params.data.id));
  res.sendStatus(204);
});

// ── Invoices ──────────────────────────────────────────────────────

router.get("/invoices", async (req, res): Promise<void> => {
  const params = ListInvoicesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  let query = db
    .select({
      id: invoicesTable.id,
      caseId: invoicesTable.caseId,
      caseName: casesTable.title,
      invoiceNumber: invoicesTable.invoiceNumber,
      clientName: invoicesTable.clientName,
      totalAmount: invoicesTable.totalAmount,
      paidAmount: invoicesTable.paidAmount,
      retainerApplied: invoicesTable.retainerApplied,
      status: invoicesTable.status,
      issuedDate: invoicesTable.issuedDate,
      dueDate: invoicesTable.dueDate,
      paidDate: invoicesTable.paidDate,
      notes: invoicesTable.notes,
      createdAt: invoicesTable.createdAt,
    })
    .from(invoicesTable)
    .leftJoin(casesTable, eq(invoicesTable.caseId, casesTable.id))
    .$dynamic();

  const conditions = [];
  if (params.data.caseId) conditions.push(eq(invoicesTable.caseId, params.data.caseId));
  if (params.data.status) conditions.push(eq(invoicesTable.status, params.data.status));
  if (conditions.length > 0) query = query.where(and(...conditions));

  const invoices = await query.orderBy(invoicesTable.issuedDate);
  res.json(ListInvoicesResponse.parse(invoices));
});

router.post("/invoices", async (req, res): Promise<void> => {
  const parsed = CreateInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const count = await db.select().from(invoicesTable);
  const invoiceNumber = `INV-${String(count.length + 1).padStart(4, "0")}`;
  const [inv] = await db.insert(invoicesTable).values(datesToStrings({ ...parsed.data, invoiceNumber })).returning();
  res.status(201).json(CreateInvoiceResponse.parse({ ...inv, caseName: null }));
});

router.get("/invoices/:id", async (req, res): Promise<void> => {
  const params = GetInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [inv] = await db
    .select({
      id: invoicesTable.id,
      caseId: invoicesTable.caseId,
      caseName: casesTable.title,
      invoiceNumber: invoicesTable.invoiceNumber,
      clientName: invoicesTable.clientName,
      totalAmount: invoicesTable.totalAmount,
      paidAmount: invoicesTable.paidAmount,
      retainerApplied: invoicesTable.retainerApplied,
      status: invoicesTable.status,
      issuedDate: invoicesTable.issuedDate,
      dueDate: invoicesTable.dueDate,
      paidDate: invoicesTable.paidDate,
      notes: invoicesTable.notes,
      createdAt: invoicesTable.createdAt,
    })
    .from(invoicesTable)
    .leftJoin(casesTable, eq(invoicesTable.caseId, casesTable.id))
    .where(eq(invoicesTable.id, params.data.id));
  if (!inv) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  res.json(GetInvoiceResponse.parse(inv));
});

router.patch("/invoices/:id", async (req, res): Promise<void> => {
  const params = UpdateInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(invoicesTable)
    .set(datesToStrings(parsed.data))
    .where(eq(invoicesTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  res.json(UpdateInvoiceResponse.parse({ ...updated, caseName: null }));
});

router.delete("/invoices/:id", async (req, res): Promise<void> => {
  const params = DeleteInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(invoicesTable).where(eq(invoicesTable.id, params.data.id));
  res.sendStatus(204);
});

// ── Expenses ──────────────────────────────────────────────────────

router.get("/expenses", async (req, res): Promise<void> => {
  const params = ListExpensesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  let query = db
    .select({
      id: expensesTable.id,
      caseId: expensesTable.caseId,
      caseName: casesTable.title,
      category: expensesTable.category,
      amount: expensesTable.amount,
      description: expensesTable.description,
      date: expensesTable.date,
      submittedBy: usersTable.name,
      submittedById: expensesTable.submittedById,
      billable: expensesTable.billable,
      createdAt: expensesTable.createdAt,
    })
    .from(expensesTable)
    .leftJoin(casesTable, eq(expensesTable.caseId, casesTable.id))
    .leftJoin(usersTable, eq(expensesTable.submittedById, usersTable.id))
    .$dynamic();

  if (params.data.caseId) {
    query = query.where(eq(expensesTable.caseId, params.data.caseId));
  }

  const expenses = await query.orderBy(expensesTable.date);
  res.json(ListExpensesResponse.parse(expenses));
});

router.post("/expenses", async (req, res): Promise<void> => {
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [expense] = await db.insert(expensesTable).values(datesToStrings(parsed.data)).returning();
  res.status(201).json(CreateExpenseResponse.parse({ ...expense, caseName: null, submittedBy: null }));
});

router.patch("/expenses/:id", async (req, res): Promise<void> => {
  const params = UpdateExpenseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(expensesTable)
    .set(datesToStrings(parsed.data))
    .where(eq(expensesTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Expense not found" });
    return;
  }
  res.json(UpdateExpenseResponse.parse({ ...updated, caseName: null, submittedBy: null }));
});

router.delete("/expenses/:id", async (req, res): Promise<void> => {
  const params = DeleteExpenseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(expensesTable).where(eq(expensesTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;

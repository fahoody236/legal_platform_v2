import { Router, type IRouter } from "express";
import { and, gte, lte, isNotNull } from "drizzle-orm";
import { db, casesTable, tasksTable, contractsTable, contractPaymentsTable, usersTable } from "@workspace/db";

const router: IRouter = Router();

/**
 * GET /calendar/events?start=YYYY-MM-DD&end=YYYY-MM-DD
 * Returns all events (court dates, deadlines, task due dates, contract dates)
 * within the given date range.
 */
router.get("/calendar/events", async (req, res) => {
  const { start, end } = req.query as { start?: string; end?: string };

  // Default to current month if not provided
  const now = new Date();
  const startDate = start ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const endDate = end ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-31`;

  const events: Array<{
    id: string;
    title: string;
    date: string;
    type: string;
    entityId: number;
    path: string;
    meta?: string;
  }> = [];

  // ── Court dates ────────────────────────────────────────────────────────────
  const courtCases = await db
    .select({
      id: casesTable.id,
      title: casesTable.title,
      clientName: casesTable.clientName,
      court: casesTable.court,
      courtDate: casesTable.courtDate,
      status: casesTable.status,
    })
    .from(casesTable)
    .where(
      and(
        isNotNull(casesTable.courtDate),
        gte(casesTable.courtDate, startDate),
        lte(casesTable.courtDate, endDate),
      ),
    );

  for (const c of courtCases) {
    events.push({
      id: `court-${c.id}`,
      title: `Court: ${c.title}`,
      date: c.courtDate!,
      type: "court_date",
      entityId: c.id,
      path: `/cases/${c.id}`,
      meta: c.court ?? c.clientName,
    });
  }

  // ── Statute deadlines ──────────────────────────────────────────────────────
  const deadlineCases = await db
    .select({
      id: casesTable.id,
      title: casesTable.title,
      clientName: casesTable.clientName,
      statuteDeadline: casesTable.statuteDeadline,
    })
    .from(casesTable)
    .where(
      and(
        isNotNull(casesTable.statuteDeadline),
        gte(casesTable.statuteDeadline, startDate),
        lte(casesTable.statuteDeadline, endDate),
      ),
    );

  for (const c of deadlineCases) {
    events.push({
      id: `deadline-${c.id}`,
      title: `Deadline: ${c.title}`,
      date: c.statuteDeadline!,
      type: "deadline",
      entityId: c.id,
      path: `/cases/${c.id}`,
      meta: c.clientName,
    });
  }

  // ── Task due dates ─────────────────────────────────────────────────────────
  const dueTasks = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      priority: tasksTable.priority,
      status: tasksTable.status,
      dueDate: tasksTable.dueDate,
    })
    .from(tasksTable)
    .where(
      and(
        isNotNull(tasksTable.dueDate),
        gte(tasksTable.dueDate, startDate),
        lte(tasksTable.dueDate, endDate),
      ),
    );

  for (const t of dueTasks) {
    if (t.status === "done") continue; // skip completed tasks
    events.push({
      id: `task-${t.id}`,
      title: `Task: ${t.title}`,
      date: t.dueDate!,
      type: "task",
      entityId: t.id,
      path: `/tasks`,
      meta: t.priority ?? undefined,
    });
  }

  // ── Contract end dates ─────────────────────────────────────────────────────
  const endingContracts = await db
    .select({
      id: contractsTable.id,
      title: contractsTable.title,
      clientName: contractsTable.clientName,
      endDate: contractsTable.endDate,
    })
    .from(contractsTable)
    .where(
      and(
        isNotNull(contractsTable.endDate),
        gte(contractsTable.endDate, startDate),
        lte(contractsTable.endDate, endDate),
      ),
    );

  for (const c of endingContracts) {
    events.push({
      id: `contract-${c.id}`,
      title: `Contract Ends: ${c.title}`,
      date: c.endDate!,
      type: "contract_end",
      entityId: c.id,
      path: `/contracts/${c.id}`,
      meta: c.clientName,
    });
  }

  // ── Payment due dates ──────────────────────────────────────────────────────
  const payments = await db
    .select({
      id: contractPaymentsTable.id,
      contractId: contractPaymentsTable.contractId,
      amount: contractPaymentsTable.amount,
      dueDate: contractPaymentsTable.dueDate,
      status: contractPaymentsTable.status,
    })
    .from(contractPaymentsTable)
    .where(
      and(
        isNotNull(contractPaymentsTable.dueDate),
        gte(contractPaymentsTable.dueDate, startDate),
        lte(contractPaymentsTable.dueDate, endDate),
      ),
    );

  for (const p of payments) {
    if (p.status === "paid") continue;
    events.push({
      id: `payment-${p.id}`,
      title: `Payment Due: SAR ${Number(p.amount).toLocaleString()}`,
      date: p.dueDate,
      type: "payment",
      entityId: p.contractId,
      path: `/contracts/${p.contractId}`,
      meta: `SAR ${Number(p.amount).toLocaleString()}`,
    });
  }

  // Sort by date
  events.sort((a, b) => a.date.localeCompare(b.date));

  res.json(events);
});

export default router;

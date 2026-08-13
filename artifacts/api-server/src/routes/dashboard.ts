import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import {
  db,
  casesTable,
  tasksTable,
  timeEntriesTable,
  invoicesTable,
  aiDraftsTable,
  usersTable,
  contractsTable,
  expensesTable,
  caseActivitiesTable,
} from "@workspace/db";
import {
  GetDashboardStatsResponse,
  GetUpcomingDeadlinesResponse,
  GetLawyerPerformanceResponse,
  GetRecentActivityResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  const [casesData, tasksData, timeData, invoicesData, aiData, usersData, contractsData, expData] =
    await Promise.all([
      db.select({ status: casesTable.status }).from(casesTable),
      db.select({ status: tasksTable.status, dueDate: tasksTable.dueDate }).from(tasksTable),
      db.select({ hours: timeEntriesTable.hours, hourlyRate: timeEntriesTable.hourlyRate, isBillable: timeEntriesTable.isBillable, invoiced: timeEntriesTable.invoiced }).from(timeEntriesTable),
      db.select({ status: invoicesTable.status, totalAmount: invoicesTable.totalAmount, paidAmount: invoicesTable.paidAmount }).from(invoicesTable),
      db.select({ status: aiDraftsTable.status }).from(aiDraftsTable),
      db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.active, true)),
      db.select({ status: contractsTable.status }).from(contractsTable),
      db.select({ amount: expensesTable.amount, date: expensesTable.date }).from(expensesTable),
    ]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

  const activeCases = casesData.filter(c => c.status === "active").length;
  const openCases = casesData.filter(c => c.status === "open").length;
  const closedCases = casesData.filter(c => c.status === "closed").length;
  const onHoldCases = casesData.filter(c => c.status === "on_hold").length;
  const pendingTasks = tasksData.filter(t => t.status === "pending" || t.status === "in_progress").length;
  const overdueTasks = tasksData.filter(t => t.dueDate && t.dueDate < now.toISOString().split("T")[0] && t.status !== "done").length;

  let unbilledHours = 0;
  let pendingInvoicesAmount = 0;
  for (const t of timeData) {
    if (t.isBillable && !t.invoiced) unbilledHours += t.hours;
  }
  for (const inv of invoicesData) {
    if (inv.status === "sent" || inv.status === "overdue") {
      pendingInvoicesAmount += inv.totalAmount - inv.paidAmount;
    }
  }

  const pendingAiDrafts = aiData.filter(d => d.status === "pending_approval").length;
  const totalLawyers = usersData.filter(u => u.role === "lawyer" || u.role === "admin").length;
  const activeContracts = contractsData.filter(c => c.status === "active").length;
  const totalExpensesThisMonth = expData
    .filter(e => e.date >= monthStart)
    .reduce((sum, e) => sum + e.amount, 0);

  res.json(GetDashboardStatsResponse.parse({
    activeCases, openCases, closedCases, onHoldCases, pendingTasks, overdueTasks,
    unbilledHours, pendingInvoicesAmount, pendingAiDrafts, totalLawyers, activeContracts, totalExpensesThisMonth,
  }));
});

router.get("/dashboard/upcoming-deadlines", async (req, res): Promise<void> => {
  const days = parseInt(String(req.query.days ?? "30"), 10);
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const today = now.toISOString().split("T")[0];
  const futureDate = future.toISOString().split("T")[0];

  const items: {
    id: number; type: string; title: string; deadline: string; daysUntil: number;
    relatedCaseId: number | null; relatedCaseName: string | null; assigneeName: string | null; priority: string | null;
  }[] = [];

  // Court deadlines
  const caseDeadlines = await db
    .select({ id: casesTable.id, title: casesTable.title, courtDate: casesTable.courtDate, statuteDeadline: casesTable.statuteDeadline })
    .from(casesTable)
    .where(eq(casesTable.status, "active"));

  for (const c of caseDeadlines) {
    if (c.courtDate && c.courtDate >= today && c.courtDate <= futureDate) {
      const daysUntil = Math.ceil((new Date(c.courtDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      items.push({ id: c.id, type: "case", title: `Court hearing: ${c.title}`, deadline: c.courtDate, daysUntil, relatedCaseId: c.id, relatedCaseName: c.title, assigneeName: null, priority: null });
    }
    if (c.statuteDeadline && c.statuteDeadline >= today && c.statuteDeadline <= futureDate) {
      const daysUntil = Math.ceil((new Date(c.statuteDeadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      items.push({ id: c.id * 1000, type: "case", title: `Statute deadline: ${c.title}`, deadline: c.statuteDeadline, daysUntil, relatedCaseId: c.id, relatedCaseName: c.title, assigneeName: null, priority: "urgent" });
    }
  }

  // Task deadlines
  const taskDeadlines = await db
    .select({ id: tasksTable.id, title: tasksTable.title, dueDate: tasksTable.dueDate, status: tasksTable.status, priority: tasksTable.priority, caseId: tasksTable.caseId, caseTitle: casesTable.title, assigneeName: usersTable.name })
    .from(tasksTable)
    .leftJoin(casesTable, eq(tasksTable.caseId, casesTable.id))
    .leftJoin(usersTable, eq(tasksTable.assigneeId, usersTable.id))
    .where(and(gte(tasksTable.dueDate, today), lte(tasksTable.dueDate, futureDate)));

  for (const t of taskDeadlines) {
    if (t.dueDate && t.status !== "done" && t.status !== "cancelled") {
      const daysUntil = Math.ceil((new Date(t.dueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      items.push({ id: t.id, type: "task", title: t.title, deadline: t.dueDate, daysUntil, relatedCaseId: t.caseId ?? null, relatedCaseName: t.caseTitle ?? null, assigneeName: t.assigneeName ?? null, priority: t.priority });
    }
  }

  items.sort((a, b) => a.daysUntil - b.daysUntil);
  res.json(GetUpcomingDeadlinesResponse.parse(items));
});

router.get("/dashboard/lawyer-performance", async (_req, res): Promise<void> => {
  const lawyers = await db.select().from(usersTable).where(eq(usersTable.role, "lawyer"));
  const allCases = await db.select({ id: casesTable.id, status: casesTable.status, assignedLawyerId: casesTable.assignedLawyerId }).from(casesTable);
  const allTimeEntries = await db.select({ lawyerId: timeEntriesTable.lawyerId, hours: timeEntriesTable.hours, hourlyRate: timeEntriesTable.hourlyRate, isBillable: timeEntriesTable.isBillable }).from(timeEntriesTable);
  const allTasks = await db.select({ assigneeId: tasksTable.assigneeId, status: tasksTable.status }).from(tasksTable);

  const performance = lawyers.map(lawyer => {
    const activeCases = allCases.filter(c => c.assignedLawyerId === lawyer.id && c.status === "active").length;
    const billableEntries = allTimeEntries.filter(e => e.lawyerId === lawyer.id && e.isBillable);
    const billableHours = billableEntries.reduce((sum, e) => sum + e.hours, 0);
    const totalRevenue = billableEntries.reduce((sum, e) => sum + e.hours * e.hourlyRate, 0);
    const lawyerTasks = allTasks.filter(t => t.assigneeId === lawyer.id);
    const tasksCompleted = lawyerTasks.filter(t => t.status === "done").length;
    const tasksPending = lawyerTasks.filter(t => t.status === "pending" || t.status === "in_progress").length;

    return {
      lawyerId: lawyer.id,
      lawyerName: lawyer.name,
      specialization: lawyer.specialization ?? null,
      activeCases,
      billableHours,
      totalRevenue,
      tasksCompleted,
      tasksPending,
      avgCaseClosureTime: null,
    };
  });

  res.json(GetLawyerPerformanceResponse.parse(performance));
});

router.get("/dashboard/recent-activity", async (_req, res): Promise<void> => {
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
    .orderBy(sql`${caseActivitiesTable.createdAt} desc`)
    .limit(20);
  res.json(GetRecentActivityResponse.parse(activities));
});

export default router;

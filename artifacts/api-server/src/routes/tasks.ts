import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, tasksTable, casesTable, usersTable } from "@workspace/db";
import { datesToStrings } from "../lib/date-utils";
import {
  ListTasksQueryParams,
  ListTasksResponse,
  CreateTaskBody,
  CreateTaskResponse,
  GetTaskParams,
  GetTaskResponse,
  UpdateTaskParams,
  UpdateTaskBody,
  UpdateTaskResponse,
  DeleteTaskParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const taskSelect = {
  id: tasksTable.id,
  title: tasksTable.title,
  description: tasksTable.description,
  caseId: tasksTable.caseId,
  caseName: casesTable.title,
  assigneeId: tasksTable.assigneeId,
  assigneeName: usersTable.name,
  createdById: tasksTable.createdById,
  status: tasksTable.status,
  priority: tasksTable.priority,
  dueDate: tasksTable.dueDate,
  completedAt: tasksTable.completedAt,
  createdAt: tasksTable.createdAt,
};

router.get("/tasks", async (req, res): Promise<void> => {
  const params = ListTasksQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  let query = db
    .select(taskSelect)
    .from(tasksTable)
    .leftJoin(casesTable, eq(tasksTable.caseId, casesTable.id))
    .leftJoin(usersTable, eq(tasksTable.assigneeId, usersTable.id))
    .$dynamic();

  const conditions = [];
  if (params.data.caseId) conditions.push(eq(tasksTable.caseId, params.data.caseId));
  if (params.data.assigneeId) conditions.push(eq(tasksTable.assigneeId, params.data.assigneeId));
  if (params.data.status) conditions.push(eq(tasksTable.status, params.data.status));
  if (conditions.length > 0) query = query.where(and(...conditions));

  const tasks = await query.orderBy(tasksTable.dueDate);
  res.json(ListTasksResponse.parse(tasks));
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [task] = await db.insert(tasksTable).values(datesToStrings(parsed.data)).returning();
  res.status(201).json(CreateTaskResponse.parse({ ...task, caseName: null, assigneeName: null }));
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [task] = await db
    .select(taskSelect)
    .from(tasksTable)
    .leftJoin(casesTable, eq(tasksTable.caseId, casesTable.id))
    .leftJoin(usersTable, eq(tasksTable.assigneeId, usersTable.id))
    .where(eq(tasksTable.id, params.data.id));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(GetTaskResponse.parse(task));
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = datesToStrings({ ...parsed.data });
  if (parsed.data.status === "done") {
    updateData.completedAt = new Date();
  }
  const [updated] = await db
    .update(tasksTable)
    .set(updateData)
    .where(eq(tasksTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(UpdateTaskResponse.parse({ ...updated, caseName: null, assigneeName: null }));
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(tasksTable).where(eq(tasksTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;

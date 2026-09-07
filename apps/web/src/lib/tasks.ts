import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiFetch } from "./api.js";

/** Mirrors TASK_STATUSES / TASK_PRIORITIES in packages/db. */
export const TASK_STATUSES = [
  "open",
  "in_progress",
  "done",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Everything a task can be set to on an edit form. `done` is an action. */
export const EDITABLE_TASK_STATUSES = TASK_STATUSES.filter(
  (value): value is Exclude<TaskStatus, "done"> => value !== "done",
);

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * Colour reinforces, never carries. Every row states its status and priority in
 * words, so a reader who cannot separate these hues loses nothing.
 */
export const TASK_STATUS_LABELS: Record<
  TaskStatus,
  { label: string; colour: string; background: string }
> = {
  open: { label: "مفتوحة", colour: "#1f6b3a", background: "#e8f4ec" },
  in_progress: { label: "قيد التنفيذ", colour: "#1f3d8f", background: "#e9eefb" },
  done: { label: "منجزة", colour: "#4a4a45", background: "#eeeeec" },
  cancelled: { label: "ملغاة", colour: "#7a1f21", background: "#fdf2f2" },
};

export const TASK_PRIORITY_LABELS: Record<
  TaskPriority,
  { label: string; colour: string; background: string }
> = {
  low: { label: "منخفضة", colour: "#55554e", background: "#f0f0ee" },
  normal: { label: "عادية", colour: "#1f3d8f", background: "#e9eefb" },
  high: { label: "عالية", colour: "#8a5a06", background: "#fdf3e3" },
};

export interface TaskRow {
  id: string;
  caseId: string;
  caseNumber: string;
  caseTitleAr: string;
  titleAr: string;
  title: string | null;
  description: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  completedAt: string | null;
  createdByUserId: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface TasksPage {
  tasks: TaskRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface TasksQuery {
  caseId?: string | undefined;
  assignedToUserId?: string | undefined;
  status?: TaskStatus | undefined;
  priority?: TaskPriority | undefined;
  overdue?: boolean | undefined;
  limit: number;
  offset: number;
}

/**
 * Late, and still live.
 *
 * The same rule the API and the partial index use: past due, not finished, not
 * cancelled, not archived. Finished work is never late, however long it took,
 * and a list that said otherwise would be counting history as a backlog.
 */
export function isOverdue(task: TaskRow): boolean {
  return (
    task.dueAt !== null &&
    task.archivedAt === null &&
    (task.status === "open" || task.status === "in_progress") &&
    new Date(task.dueAt).getTime() < Date.now()
  );
}

function retryUnlessAnswered(failureCount: number, error: Error): boolean {
  const status = (error as { status?: number }).status;

  if (status === 401 || status === 403 || status === 404) {
    return false;
  }

  return failureCount < 2;
}

export function useTasks(query: TasksQuery): UseQueryResult<TasksPage> {
  const search = new URLSearchParams({
    limit: String(query.limit),
    offset: String(query.offset),
  });

  if (query.caseId) search.set("caseId", query.caseId);
  if (query.assignedToUserId) {
    search.set("assignedToUserId", query.assignedToUserId);
  }
  if (query.status) search.set("status", query.status);
  if (query.priority) search.set("priority", query.priority);
  if (query.overdue) search.set("overdue", "true");

  return useQuery({
    queryKey: ["tasks", "list", search.toString()],
    queryFn: () => apiFetch<TasksPage>(`/api/tasks?${search.toString()}`),
    retry: retryUnlessAnswered,
    placeholderData: (previous) => previous,
  });
}

/**
 * Every task mutation invalidates the whole `["tasks"]` tree.
 *
 * A completed task leaves the "open" list, joins the "done" one, stops being
 * overdue, and changes two totals. Reproducing that in the cache means
 * reimplementing the server's filters; one refetch cannot be subtly wrong.
 */
function useTaskMutation<TBody, TResult>(
  request: (body: TBody) => Promise<TResult>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export interface CreateTaskBody {
  caseId: string;
  titleAr: string;
  title?: string | null;
  description?: string | null;
  assignedToUserId?: string | null;
  status: Exclude<TaskStatus, "done">;
  priority: TaskPriority;
  dueAt?: string | null;
}

export type UpdateTaskBody = Omit<
  CreateTaskBody,
  "caseId" | "assignedToUserId"
>;

export function useCreateTask() {
  return useTaskMutation((body: CreateTaskBody) =>
    apiFetch<{ task: TaskRow }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    }).then((response) => response.task),
  );
}

export function useUpdateTask(taskId: string) {
  return useTaskMutation((body: UpdateTaskBody) =>
    apiFetch<{ task: TaskRow }>(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then((response) => response.task),
  );
}

export function useAssignTask(taskId: string) {
  return useTaskMutation((assignedToUserId: string | null) =>
    apiFetch<{ task: TaskRow }>(
      `/api/tasks/${encodeURIComponent(taskId)}/assign`,
      { method: "PATCH", body: JSON.stringify({ assignedToUserId }) },
    ).then((response) => response.task),
  );
}

/**
 * Its own call because it is its own operation: status and completion time are
 * written together, bound by a CHECK constraint, and it earns a distinct audit
 * entry that answers "who finished this and when".
 */
export function useCompleteTask(taskId: string) {
  return useTaskMutation(() =>
    apiFetch<{ task: TaskRow }>(
      `/api/tasks/${encodeURIComponent(taskId)}/complete`,
      { method: "POST" },
    ).then((response) => response.task),
  );
}

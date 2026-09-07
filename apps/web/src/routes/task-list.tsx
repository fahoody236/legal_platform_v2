import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ApiError, isApiError } from "../lib/api.js";
import { formatDate } from "../lib/dates.js";
import { useHasPermission } from "../lib/session.js";
import {
  EDITABLE_TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  isOverdue,
  useAssignTask,
  useCompleteTask,
  useCreateTask,
  useUpdateTask,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
} from "../lib/tasks.js";
import { useDirectory, userDisplayName } from "../lib/users.js";

function messageFor(error: unknown): string | null {
  if (error instanceof ApiError) {
    if (error.status === 403) return "لا تملك صلاحية تنفيذ هذا الإجراء.";
    if (error.status === 404) return "لم تعد هذه المهمة متاحة.";
    if (error.status === 400) return "راجع الحقول ثم حاول مرة أخرى.";
    return "تعذّر الحفظ. حاول مرة أخرى.";
  }

  if (error) {
    return "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى.";
  }

  return null;
}

function Badge({
  label,
  colour,
  background,
}: {
  label: string;
  colour: string;
  background: string;
}) {
  return (
    <span className="badge" style={{ color: colour, background }}>
      {label}
    </span>
  );
}

/**
 * One task, with the actions the reader's permissions allow.
 *
 * The three controls map one to one onto three permissions — `tasks.edit` for
 * editing and completing, `tasks.assign` for the assignee — because that is how
 * the API divides them. A firm that grants only `tasks.assign` gets a row it can
 * reassign and nothing else, which is the shape it asked for.
 */
export function TaskItem({
  task,
  showCase,
}: {
  task: TaskRow;
  showCase: boolean;
}) {
  const canEdit = useHasPermission("tasks.edit");
  const canAssign = useHasPermission("tasks.assign");
  const [editing, setEditing] = useState(false);

  const complete = useCompleteTask(task.id);
  const assign = useAssignTask(task.id);
  const directory = useDirectory(canAssign);

  const status = TASK_STATUS_LABELS[task.status];
  const priority = TASK_PRIORITY_LABELS[task.priority];
  const late = isOverdue(task);

  if (editing) {
    return (
      <li className="task-form-row">
        <TaskForm
          mode="edit"
          task={task}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  const cannotListUsers = isApiError(directory.error, 403);
  const users = directory.data ?? [];
  const assigneeAbsent =
    task.assignedToUserId !== null &&
    !users.some((user) => user.id === task.assignedToUserId);

  return (
    <li className={task.status === "done" ? "task done" : "task"}>
      <div className="task-main">
        <div className="task-title">
          <strong>{task.titleAr}</strong>
          <Badge {...status} />
          <Badge {...priority} />
          {late && (
            <span className="badge" style={{ color: "#7a1f21", background: "#fdf2f2" }}>
              متأخرة
            </span>
          )}
        </div>

        {task.description && <p className="task-description">{task.description}</p>}

        <p className="task-meta">
          {showCase && (
            <>
              <Link to="/cases/$caseId" params={{ caseId: task.caseId }} search={{}}>
                <span dir="ltr" className="case-number">
                  {task.caseNumber}
                </span>
                {" — "}
                {task.caseTitleAr}
              </Link>
              <span className="muted"> · </span>
            </>
          )}

          {task.dueAt ? (
            <span>الاستحقاق: {formatDate(task.dueAt)}</span>
          ) : (
            <span className="muted">بلا موعد استحقاق</span>
          )}

          {task.completedAt && (
            <>
              <span className="muted"> · </span>
              <span>أُنجزت في {formatDate(task.completedAt)}</span>
            </>
          )}
        </p>
      </div>

      <div className="task-actions">
        {canAssign ? (
          <select
            aria-label="المسؤول عن المهمة"
            value={task.assignedToUserId ?? ""}
            disabled={assign.isPending}
            onChange={(event) => {
              const next = event.target.value;
              assign.mutate(next === "" ? null : next);
            }}
          >
            <option value="">غير مُسندة</option>

            {/*
              A colleague who has left is shown while they hold the task and
              cannot be chosen again — the same rule as case assignment. The
              name comes from the task record, not the directory, so it survives
              them being disabled or the directory being out of reach.
            */}
            {assigneeAbsent && task.assignedToUserId && (
              <option value={task.assignedToUserId} disabled>
                {task.assignedToName ?? "—"}
                {cannotListUsers ? "" : " (معطّل)"}
              </option>
            )}

            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {userDisplayName(user)}
              </option>
            ))}
          </select>
        ) : (
          <span className="muted">
            {task.assignedToName ?? "غير مُسندة"}
          </span>
        )}

        {canEdit && (
          <>
            {task.status !== "done" && (
              <button
                type="button"
                disabled={complete.isPending}
                onClick={() => complete.mutate(undefined)}
              >
                {complete.isPending ? "…" : "إنجاز"}
              </button>
            )}

            <button
              type="button"
              className="link"
              onClick={() => setEditing(true)}
            >
              تعديل
            </button>
          </>
        )}
      </div>

      {(complete.error || assign.error) && (
        <p className="field-error" role="alert">
          {messageFor(complete.error ?? assign.error)}
        </p>
      )}
    </li>
  );
}

interface FormValues {
  titleAr: string;
  title: string;
  description: string;
  status: Exclude<TaskStatus, "done">;
  priority: TaskPriority;
  dueAt: string;
}

/**
 * Adding a task, and editing one.
 *
 * There is no "done" in the status select, on either mode. Completing writes a
 * status and a timestamp together — the database binds them — so it is the
 * button on the row, not a value here. Leaving it in the list would offer a
 * choice the API answers with a 400.
 */
export function TaskForm({
  mode,
  caseId,
  task,
  onDone,
}: {
  mode: "create" | "edit";
  caseId?: string;
  task?: TaskRow;
  onDone: () => void;
}) {
  const [values, setValues] = useState<FormValues>({
    titleAr: task?.titleAr ?? "",
    title: task?.title ?? "",
    description: task?.description ?? "",
    status: (task?.status === "done" ? "open" : task?.status) ?? "open",
    priority: task?.priority ?? "normal",
    // <input type="date"> wants YYYY-MM-DD; the API sends an ISO instant.
    dueAt: task?.dueAt ? task.dueAt.slice(0, 10) : "",
  });
  const [titleError, setTitleError] = useState<string | null>(null);

  const create = useCreateTask();
  const update = useUpdateTask(task?.id ?? "");
  const mutation = mode === "create" ? create : update;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The task form on the case screen sits inside no other form today, but the
    // client quick-add taught the lesson: a submit that concerns this form
    // should not travel further.
    event.stopPropagation();

    if (!values.titleAr.trim()) {
      setTitleError("هذا الحقل مطلوب.");
      return;
    }

    const body = {
      titleAr: values.titleAr.trim(),
      title: values.title.trim() || null,
      description: values.description.trim() || null,
      status: values.status,
      priority: values.priority,
      // Date only, read as midnight UTC. A due date is a day, not an instant —
      // see the note in dates.ts about fields that must not shift with the
      // reader's time zone.
      dueAt: values.dueAt ? `${values.dueAt}T00:00:00.000Z` : null,
    };

    if (mode === "create") {
      if (!caseId) return;
      create.mutate({ ...body, caseId }, { onSuccess: onDone });
    } else {
      update.mutate(body, { onSuccess: onDone });
    }
  }

  const message = messageFor(mutation.error);

  return (
    <form className="task-form" onSubmit={handleSubmit} noValidate>
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}

      <div className="field">
        <label htmlFor="task-titleAr">عنوان المهمة</label>
        <input
          id="task-titleAr"
          value={values.titleAr}
          aria-describedby={titleError ? "task-titleAr-error" : undefined}
          onChange={(event) => {
            setValues((c) => ({ ...c, titleAr: event.target.value }));
            setTitleError(null);
          }}
        />
        {titleError && (
          <p className="field-error" id="task-titleAr-error" role="alert">
            {titleError}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="task-description">الوصف — اختياري</label>
        <textarea
          id="task-description"
          rows={2}
          value={values.description}
          onChange={(event) =>
            setValues((c) => ({ ...c, description: event.target.value }))
          }
        />
      </div>

      <div className="task-form-row-inline">
        <div className="field">
          <label htmlFor="task-status">الحالة</label>
          <select
            id="task-status"
            value={values.status}
            onChange={(event) =>
              setValues((c) => ({
                ...c,
                status: event.target.value as Exclude<TaskStatus, "done">,
              }))
            }
          >
            {EDITABLE_TASK_STATUSES.map((value) => (
              <option key={value} value={value}>
                {TASK_STATUS_LABELS[value].label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="task-priority">الأولوية</label>
          <select
            id="task-priority"
            value={values.priority}
            onChange={(event) =>
              setValues((c) => ({
                ...c,
                priority: event.target.value as TaskPriority,
              }))
            }
          >
            {TASK_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {TASK_PRIORITY_LABELS[value].label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="task-dueAt">تاريخ الاستحقاق — اختياري</label>
          <input
            id="task-dueAt"
            type="date"
            dir="ltr"
            value={values.dueAt}
            onChange={(event) =>
              setValues((c) => ({ ...c, dueAt: event.target.value }))
            }
          />
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending
            ? "جارٍ الحفظ…"
            : mode === "create"
              ? "إضافة"
              : "حفظ"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={mutation.isPending}
          onClick={onDone}
        >
          إلغاء
        </button>
      </div>
    </form>
  );
}

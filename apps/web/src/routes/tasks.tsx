import { useNavigate, useSearch } from "@tanstack/react-router";
import { isApiError } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  useTasks,
  type TaskPriority,
  type TaskStatus,
} from "../lib/tasks.js";
import { AppHeader } from "./app-header.js";
import { TaskItem } from "./task-list.js";

const PAGE_SIZE = 25;

export interface TasksSearch {
  status?: TaskStatus | undefined;
  priority?: TaskPriority | undefined;
  overdue?: boolean | undefined;
  /** "Mine" is a filter, not a route — see the note below. */
  mine?: boolean | undefined;
  offset?: number | undefined;
}

/**
 * The firm's tasks.
 *
 * "My tasks" and "overdue" are filters on this one list rather than screens of
 * their own. They are questions about the same set, and separate screens would
 * be separate code paths that eventually disagree about what counts as
 * archived, or as late. Both live in the URL, so either is a link someone can
 * bookmark or send to a colleague.
 *
 * `mine` resolves to the signed-in person's id at request time rather than
 * being written into the URL. A link to "my tasks" then means *the reader's*
 * tasks, which is what anyone sending that link intends — a link carrying a
 * user id would show the sender's work to whoever opened it.
 */
export function TasksPage() {
  const search = useSearch({ from: "/tasks" });
  const navigate = useNavigate();
  const session = useSession();

  const offset = search.offset ?? 0;
  const mine = search.mine ?? false;
  const myUserId = session.data?.user.userId;

  const tasks = useTasks({
    status: search.status,
    priority: search.priority,
    overdue: search.overdue,
    assignedToUserId: mine ? myUserId : undefined,
    limit: PAGE_SIZE,
    offset,
  });

  function setSearch(next: TasksSearch) {
    void navigate({ to: "/tasks", search: next });
  }

  const base = {
    status: search.status,
    priority: search.priority,
    overdue: search.overdue,
    mine: search.mine,
  };

  const total = tasks.data?.total ?? 0;
  const lastOffset = Math.max(
    0,
    Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE,
  );
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <main className="wide">
      <AppHeader title="المهام" />

      <div className="filters">
        <label htmlFor="task-status-filter">الحالة</label>
        <select
          id="task-status-filter"
          value={search.status ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            setSearch({
              ...base,
              status: value === "" ? undefined : (value as TaskStatus),
              offset: 0,
            });
          }}
        >
          <option value="">جميع الحالات</option>
          {TASK_STATUSES.map((value) => (
            <option key={value} value={value}>
              {TASK_STATUS_LABELS[value].label}
            </option>
          ))}
        </select>

        <label htmlFor="task-priority-filter">الأولوية</label>
        <select
          id="task-priority-filter"
          value={search.priority ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            setSearch({
              ...base,
              priority: value === "" ? undefined : (value as TaskPriority),
              offset: 0,
            });
          }}
        >
          <option value="">جميع الأولويات</option>
          {TASK_PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {TASK_PRIORITY_LABELS[value].label}
            </option>
          ))}
        </select>

        <label className="toggle">
          <input
            type="checkbox"
            checked={mine}
            onChange={(event) =>
              setSearch({ ...base, mine: event.target.checked || undefined, offset: 0 })
            }
          />
          مهامي
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={search.overdue ?? false}
            onChange={(event) =>
              setSearch({
                ...base,
                overdue: event.target.checked || undefined,
                offset: 0,
              })
            }
          />
          المتأخرة فقط
        </label>
      </div>

      <TasksBody
        isPending={tasks.isPending || (mine && myUserId === undefined)}
        error={tasks.error}
        tasks={tasks.data?.tasks ?? []}
      />

      {tasks.isSuccess && total > 0 && (
        <nav className="pagination" aria-label="التنقل بين الصفحات">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() =>
              setSearch({ ...base, offset: Math.max(0, offset - PAGE_SIZE) })
            }
          >
            السابق
          </button>

          <span className="page-count">
            <span dir="ltr">
              {pageStart}–{pageEnd}
            </span>{" "}
            من {total}
          </span>

          <button
            type="button"
            disabled={offset >= lastOffset}
            onClick={() => setSearch({ ...base, offset: offset + PAGE_SIZE })}
          >
            التالي
          </button>
        </nav>
      )}
    </main>
  );
}

function TasksBody({
  isPending,
  error,
  tasks,
}: {
  isPending: boolean;
  error: unknown;
  tasks: ReturnType<typeof useTasks>["data"] extends infer T
    ? T extends { tasks: infer U }
      ? U
      : never
    : never;
}) {
  if (isPending) {
    return (
      <p className="state" role="status" aria-live="polite">
        جارٍ تحميل المهام…
      </p>
    );
  }

  if (isApiError(error, 403)) {
    return (
      <p className="state denied" role="alert">
        لا تملك صلاحية عرض المهام. راجع مدير المكتب لمنحك صلاحية «عرض المهام».
      </p>
    );
  }

  if (error) {
    return (
      <p className="state error" role="alert">
        تعذّر تحميل المهام. حاول مرة أخرى.
      </p>
    );
  }

  if (tasks.length === 0) {
    return <p className="state">لا توجد مهام مطابقة.</p>;
  }

  return (
    <ul className="task-list">
      {tasks.map((task) => (
        // Outside a case page, the matter is the context a task needs most.
        <TaskItem key={task.id} task={task} showCase />
      ))}
    </ul>
  );
}

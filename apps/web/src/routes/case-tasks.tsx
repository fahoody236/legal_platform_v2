import { useState } from "react";
import { isApiError } from "../lib/api.js";
import { useHasPermission } from "../lib/session.js";
import { useTasks } from "../lib/tasks.js";
import { TaskForm, TaskItem } from "./task-list.js";

/**
 * The tasks on one matter.
 *
 * Rendered only with `tasks.view`. Someone without it sees a case page with no
 * task section at all rather than an empty one — an empty list would say the
 * matter has no work on it, which is a different and possibly false statement.
 */
export function CaseTasks({ caseId }: { caseId: string }) {
  const canView = useHasPermission("tasks.view");
  const canCreate = useHasPermission("tasks.create");
  const [adding, setAdding] = useState(false);

  const tasks = useTasks({ caseId, limit: 100, offset: 0 });

  if (!canView) {
    return null;
  }

  return (
    <section className="tasks-section">
      <header className="page-header">
        <h2>المهام</h2>
        {canCreate && !adding && (
          <button type="button" onClick={() => setAdding(true)}>
            إضافة مهمة
          </button>
        )}
      </header>

      {adding && (
        <TaskForm
          mode="create"
          caseId={caseId}
          onDone={() => setAdding(false)}
        />
      )}

      {tasks.isPending && (
        <p className="state" role="status" aria-live="polite">
          جارٍ تحميل المهام…
        </p>
      )}

      {isApiError(tasks.error, 403) && (
        <p className="state denied" role="alert">
          لا تملك صلاحية عرض المهام.
        </p>
      )}

      {tasks.error && !isApiError(tasks.error, 403) && (
        <p className="state error" role="alert">
          تعذّر تحميل المهام. حاول مرة أخرى.
        </p>
      )}

      {tasks.isSuccess && tasks.data.tasks.length === 0 && !adding && (
        <p className="state">لا توجد مهام على هذه القضية.</p>
      )}

      <ul className="task-list">
        {(tasks.data?.tasks ?? []).map((task) => (
          // The case is already the page, so its number would be on every row.
          <TaskItem key={task.id} task={task} showCase={false} />
        ))}
      </ul>
    </section>
  );
}

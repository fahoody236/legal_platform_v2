import { isApiError } from "../lib/api.js";
import { useAssignCase, type CaseRow } from "../lib/cases.js";
import { useDirectory, userDisplayName } from "../lib/users.js";

const UNASSIGNED = "";

/**
 * Who carries this matter.
 *
 * Rendered only with `cases.assign`, which is a separate permission from
 * `cases.edit` — assignment allocates work and reveals who is on what, and a
 * firm is more likely to want that held narrowly
 * (docs/decisions/0004-permissions.md). The API enforces the split; this only
 * keeps a control that cannot work off the screen.
 *
 * ── Two people the list must treat differently ───────────────────────────────
 *
 * **A colleague who has left.** `/api/users` omits disabled users, so they can
 * never be *chosen*. But a case assigned to one before they left must still say
 * so: the name comes from the case record, resolved by the API's join, which
 * has no disabled filter. The current holder therefore appears as an option
 * marked `disabled` — HTML lets a disabled option *be* the selected value while
 * refusing to let it be re-selected, which is exactly the rule: displayable,
 * not choosable. Same treatment as an archived client on the case form.
 *
 * **The person holding `cases.assign` without `users.view`.** They cannot list
 * colleagues, and hiding the control would make a permission their firm
 * deliberately granted look broken. So it renders: it shows who currently holds
 * the case, offers the one action that needs no directory — removing the
 * assignment — and says plainly that choosing someone else needs `users.view`.
 * That is not a workaround; it is the honest shape of the two permissions.
 * Deciding who does the work requires knowing who exists.
 */
export function CaseAssignment({ record }: { record: CaseRow }) {
  const assign = useAssignCase(record.id);
  const directory = useDirectory(true);

  const cannotListUsers = isApiError(directory.error, 403);
  const users = directory.data ?? [];

  // The current holder, when the directory does not contain them — a colleague
  // who has since been disabled, or anyone at all when the directory is out of
  // reach.
  const currentIsAbsent =
    record.assignedLawyerId !== null &&
    !users.some((user) => user.id === record.assignedLawyerId);

  const value = record.assignedLawyerId ?? UNASSIGNED;

  return (
    <section className="assignment">
      <label htmlFor="assigned-lawyer">المحامي المسؤول</label>

      <select
        id="assigned-lawyer"
        value={value}
        disabled={assign.isPending || directory.isPending}
        onChange={(event) => {
          const next = event.target.value;
          assign.mutate(next === UNASSIGNED ? null : next);
        }}
      >
        <option value={UNASSIGNED}>غير مُسند</option>

        {currentIsAbsent && record.assignedLawyerId && (
          // Selected, and unselectable. See the note above.
          <option value={record.assignedLawyerId} disabled>
            {record.assignedLawyerName ?? "—"}
            {cannotListUsers ? "" : " (معطّل)"}
          </option>
        )}

        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {userDisplayName(user)}
          </option>
        ))}
      </select>

      {assign.isPending && (
        <p className="hint" role="status">
          جارٍ الحفظ…
        </p>
      )}

      {cannotListUsers && (
        <p className="hint">
          لا تملك صلاحية عرض المستخدمين، لذا لا يمكن اختيار محامٍ آخر. يمكنك
          إلغاء الإسناد. راجع مدير المكتب لمنحك صلاحية «عرض المستخدمين».
        </p>
      )}

      {directory.error && !cannotListUsers && (
        <p className="field-error" role="alert">
          تعذّر تحميل قائمة المحامين.
        </p>
      )}

      {assign.error && (
        <p className="field-error" role="alert">
          {isApiError(assign.error, 403)
            ? "لا تملك صلاحية إسناد القضايا."
            : isApiError(assign.error, 404)
              ? "لم يعد هذا المحامي متاحاً. حدّث الصفحة ثم حاول مرة أخرى."
              : isApiError(assign.error, 400)
                ? "تعذّر حفظ الإسناد. حاول مرة أخرى."
                : "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى."}
        </p>
      )}
    </section>
  );
}

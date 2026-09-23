import { useState, type FormEvent } from "react";
import { ApiError, isApiError } from "../lib/api.js";
import { formatDateTime } from "../lib/dates.js";
import {
  HEARING_STATUS_LABELS,
  HEARING_TYPES,
  HEARING_TYPE_LABELS,
  SETTABLE_HEARING_STATUSES,
  isUpcoming,
  useAdjournHearing,
  useCreateHearing,
  useHearings,
  useSetHearingStatus,
  useUpdateHearing,
  type HearingRow,
  type HearingStatus,
  type HearingType,
} from "../lib/hearings.js";
import { useHasPermission } from "../lib/session.js";

function messageFor(error: unknown): string | null {
  if (error instanceof ApiError) {
    if (error.status === 403) return "لا تملك صلاحية إدارة الجلسات.";
    if (error.status === 404) return "لم تعد هذه الجلسة متاحة.";
    if (error.status === 400) return "راجع الحقول ثم حاول مرة أخرى.";
    return "تعذّر الحفظ. حاول مرة أخرى.";
  }

  if (error) {
    return "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى.";
  }

  return null;
}

/**
 * `datetime-local` wants "YYYY-MM-DDTHH:mm" in local time; the API speaks ISO
 * in UTC. These two convert, and they are the only place that knows it.
 */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

/**
 * The court dates on one matter.
 *
 * Rendered only with `hearings.view`. Someone without it sees a case page with
 * no hearings section at all rather than an empty one — an empty list would
 * say this matter has no court dates, which is a different and possibly false
 * statement.
 */
export function CaseHearings({
  caseId,
  caseCourt,
}: {
  caseId: string;
  /** Shown as the placeholder on the court field: most hearings sit here. */
  caseCourt: string | null;
}) {
  const canView = useHasPermission("hearings.view");
  const canManage = useHasPermission("hearings.manage");
  const [adding, setAdding] = useState(false);

  const hearings = useHearings({ caseId, limit: 100, offset: 0 }, canView);

  if (!canView) {
    return null;
  }

  const rows = hearings.data?.hearings ?? [];

  return (
    <section className="tasks-section">
      <header className="page-header">
        <h2>الجلسات</h2>
        {canManage && !adding && (
          <button type="button" onClick={() => setAdding(true)}>
            إضافة جلسة
          </button>
        )}
      </header>

      {adding && (
        <HearingForm
          mode="create"
          caseId={caseId}
          caseCourt={caseCourt}
          onDone={() => setAdding(false)}
        />
      )}

      {hearings.isPending && (
        <p className="state" role="status" aria-live="polite">
          جارٍ تحميل الجلسات…
        </p>
      )}

      {isApiError(hearings.error, 403) && (
        <p className="state denied" role="alert">
          لا تملك صلاحية عرض الجلسات.
        </p>
      )}

      {hearings.error && !isApiError(hearings.error, 403) && (
        <p className="state error" role="alert">
          تعذّر تحميل الجلسات. حاول مرة أخرى.
        </p>
      )}

      {hearings.isSuccess && rows.length === 0 && !adding && (
        <p className="state empty">لا توجد جلسات مسجَّلة على هذه القضية.</p>
      )}

      {rows.length > 0 && (
        <ul className="task-list">
          {rows.map((hearing) => (
            <HearingItem
              key={hearing.id}
              hearing={hearing}
              caseCourt={caseCourt}
              canManage={canManage}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One hearing, with whichever of the three actions the reader may take. */
function HearingItem({
  hearing,
  caseCourt,
  canManage,
}: {
  hearing: HearingRow;
  caseCourt: string | null;
  canManage: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "status" | "adjourn">(
    "view",
  );

  const status = HEARING_STATUS_LABELS[hearing.status];
  const ahead = isUpcoming(hearing);

  if (mode === "edit") {
    return (
      <li className="task-form-row">
        <HearingForm
          mode="edit"
          hearing={hearing}
          caseCourt={caseCourt}
          onDone={() => setMode("view")}
        />
      </li>
    );
  }

  if (mode === "status") {
    return (
      <li className="task-form-row">
        <StatusForm hearing={hearing} onDone={() => setMode("view")} />
      </li>
    );
  }

  if (mode === "adjourn") {
    return (
      <li className="task-form-row">
        <AdjournForm hearing={hearing} onDone={() => setMode("view")} />
      </li>
    );
  }

  return (
    <li className={hearing.status === "scheduled" ? "task" : "task done"}>
      <div className="task-main">
        <div className="task-title">
          <strong>{formatDateTime(hearing.scheduledAt)}</strong>
          <span
            className="badge"
            style={{ color: status.colour, background: status.background }}
          >
            {status.label}
          </span>
          <span
            className="badge"
            style={{ color: "#55554e", background: "#f0f0ee" }}
          >
            {HEARING_TYPE_LABELS[hearing.hearingType]}
          </span>
          {ahead && (
            <span
              className="badge"
              style={{ color: "#1f6b3a", background: "#e8f4ec" }}
            >
              قادمة
            </span>
          )}
        </div>

        <p className="task-meta">
          {/* The case's court unless this hearing names its own — resolved by
              the API so every screen answers it the same way. */}
          {hearing.effectiveCourt ?? (
            <span className="muted">المحكمة غير مُسجَّلة</span>
          )}
          {hearing.court && hearing.court !== caseCourt && (
            <span className="muted"> (تختلف عن محكمة القضية)</span>
          )}
          {hearing.circuit && (
            <>
              <span className="muted"> · </span>
              الدائرة: {hearing.circuit}
            </>
          )}
        </p>

        {/* Only ever present once the hearing has happened; see the form. */}
        {hearing.notes && <p className="task-description">{hearing.notes}</p>}
      </div>

      {canManage && (
        <div className="task-actions">
          <button
            type="button"
            className="link"
            onClick={() => setMode("edit")}
          >
            تعديل
          </button>
          <button
            type="button"
            className="link"
            onClick={() => setMode("status")}
          >
            تسجيل الحالة
          </button>
          {/* Adjournment only makes sense for a hearing that has not yet been
              resolved one way or another. */}
          {hearing.status === "scheduled" && (
            <button
              type="button"
              className="link"
              onClick={() => setMode("adjourn")}
            >
              تأجيل
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Scheduling a hearing, and correcting one.
 *
 * There is no notes field on create, and that is the answer to "notes are only
 * meaningful once a hearing has happened": a hearing being scheduled has
 * nothing to record yet, and a box offered here fills with preparation
 * reminders — "العميل يحضر الهوية" — which then read as a record of what
 * happened once the date has passed. Preparation is what tasks are for.
 *
 * On edit the field appears only once the hearing has left `scheduled`, so
 * correcting what was recorded stays possible without inviting a note about a
 * hearing that is still ahead.
 */
function HearingForm({
  mode,
  caseId,
  hearing,
  caseCourt,
  onDone,
}: {
  mode: "create" | "edit";
  caseId?: string;
  hearing?: HearingRow;
  caseCourt: string | null;
  onDone: () => void;
}) {
  const [scheduledAt, setScheduledAt] = useState(
    hearing ? toLocalInput(hearing.scheduledAt) : "",
  );
  const [court, setCourt] = useState(hearing?.court ?? "");
  const [circuit, setCircuit] = useState(hearing?.circuit ?? "");
  const [hearingType, setHearingType] = useState<HearingType>(
    hearing?.hearingType ?? "pleading",
  );
  const [notes, setNotes] = useState(hearing?.notes ?? "");

  const create = useCreateHearing();
  const update = useUpdateHearing(hearing?.id ?? "");
  const mutation = mode === "create" ? create : update;

  const showNotes = mode === "edit" && hearing?.status !== "scheduled";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (mode === "create" && caseId) {
      create.mutate(
        {
          caseId,
          scheduledAt: fromLocalInput(scheduledAt),
          court: court.trim() || null,
          circuit: circuit.trim() || null,
          hearingType,
        },
        { onSuccess: onDone },
      );
      return;
    }

    update.mutate(
      {
        scheduledAt: fromLocalInput(scheduledAt),
        court: court.trim() || null,
        circuit: circuit.trim() || null,
        hearingType,
        ...(showNotes ? { notes: notes.trim() || null } : {}),
      },
      { onSuccess: onDone },
    );
  }

  const error = messageFor(mutation.error);

  return (
    <form className="task-form" onSubmit={handleSubmit} noValidate>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="task-form-row-inline">
        <div className="field">
          <label htmlFor={`hearing-when-${hearing?.id ?? "new"}`}>
            موعد الجلسة
          </label>
          <input
            id={`hearing-when-${hearing?.id ?? "new"}`}
            type="datetime-local"
            required
            value={scheduledAt}
            disabled={mutation.isPending}
            onChange={(event) => setScheduledAt(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor={`hearing-type-${hearing?.id ?? "new"}`}>
            نوع الجلسة
          </label>
          <select
            id={`hearing-type-${hearing?.id ?? "new"}`}
            value={hearingType}
            disabled={mutation.isPending}
            onChange={(event) =>
              setHearingType(event.target.value as HearingType)
            }
          >
            {HEARING_TYPES.map((value) => (
              <option key={value} value={value}>
                {HEARING_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="task-form-row-inline">
        <div className="field">
          <label htmlFor={`hearing-court-${hearing?.id ?? "new"}`}>
            المحكمة — اختياري
          </label>
          <input
            id={`hearing-court-${hearing?.id ?? "new"}`}
            type="text"
            // The case's court as the placeholder rather than the value: an
            // empty field means "the case's court", so leaving it alone keeps
            // the two in step if the case is ever corrected.
            placeholder={caseCourt ?? "محكمة القضية"}
            value={court}
            disabled={mutation.isPending}
            onChange={(event) => setCourt(event.target.value)}
          />
          <p className="hint">اتركه فارغاً إذا كانت الجلسة في محكمة القضية.</p>
        </div>

        <div className="field">
          <label htmlFor={`hearing-circuit-${hearing?.id ?? "new"}`}>
            الدائرة — اختياري
          </label>
          <input
            id={`hearing-circuit-${hearing?.id ?? "new"}`}
            type="text"
            value={circuit}
            disabled={mutation.isPending}
            onChange={(event) => setCircuit(event.target.value)}
          />
        </div>
      </div>

      {showNotes && (
        <div className="field">
          <label htmlFor={`hearing-notes-${hearing?.id ?? "new"}`}>
            ما جرى في الجلسة
          </label>
          <textarea
            id={`hearing-notes-${hearing?.id ?? "new"}`}
            rows={3}
            value={notes}
            disabled={mutation.isPending}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
      )}

      <div className="form-actions">
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending
            ? "جارٍ الحفظ…"
            : mode === "create"
              ? "إضافة الجلسة"
              : "حفظ التعديلات"}
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

/** The label on the notes field follows the outcome being recorded. */
const NOTES_LABELS: Record<Exclude<HearingStatus, "adjourned">, string> = {
  held: "ما جرى في الجلسة",
  cancelled: "سبب الإلغاء",
  scheduled: "ملاحظة",
};

/**
 * Recording what became of a hearing.
 *
 * This is where notes belong: the hearing has just happened, and the person
 * saying so is the person who knows what it produced. `adjourned` is not in
 * the list — it writes a second row, so it has its own form.
 */
function StatusForm({
  hearing,
  onDone,
}: {
  hearing: HearingRow;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<Exclude<HearingStatus, "adjourned">>(
    hearing.status === "adjourned" ? "held" : hearing.status,
  );
  const [notes, setNotes] = useState(hearing.notes ?? "");
  const mutation = useSetHearingStatus(hearing.id);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(
      { status, notes: notes.trim() || null },
      { onSuccess: onDone },
    );
  }

  const error = messageFor(mutation.error);

  return (
    <form className="task-form" onSubmit={handleSubmit} noValidate>
      <h3>تسجيل حالة الجلسة</h3>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="field">
        <label htmlFor={`status-${hearing.id}`}>الحالة</label>
        <select
          id={`status-${hearing.id}`}
          value={status}
          disabled={mutation.isPending}
          onChange={(event) =>
            setStatus(event.target.value as Exclude<HearingStatus, "adjourned">)
          }
        >
          {SETTABLE_HEARING_STATUSES.map((value) => (
            <option key={value} value={value}>
              {HEARING_STATUS_LABELS[value].label}
            </option>
          ))}
        </select>
        <p className="hint">
          للتأجيل استخدم زر «تأجيل» — فهو يسجّل هذه الجلسة كمؤجلة وينشئ الجلسة
          التالية.
        </p>
      </div>

      <div className="field">
        <label htmlFor={`status-notes-${hearing.id}`}>
          {NOTES_LABELS[status]}
        </label>
        <textarea
          id={`status-notes-${hearing.id}`}
          rows={3}
          value={notes}
          disabled={mutation.isPending}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      <div className="form-actions">
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
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

/**
 * Adjournment: one form, two rows.
 *
 * The next date is optional, and the hint says so. A court that adjourned
 * without setting one is an ordinary outcome, and a form that demanded a date
 * would be answered with an invented one.
 */
function AdjournForm({
  hearing,
  onDone,
}: {
  hearing: HearingRow;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [circuit, setCircuit] = useState(hearing.circuit ?? "");
  const [hearingType, setHearingType] = useState<HearingType>(
    hearing.hearingType,
  );
  const mutation = useAdjournHearing(hearing.id);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    mutation.mutate(
      {
        notes: notes.trim() || null,
        ...(scheduledAt ? { scheduledAt: fromLocalInput(scheduledAt) } : {}),
        circuit: circuit.trim() || null,
        hearingType,
      },
      { onSuccess: onDone },
    );
  }

  const error = messageFor(mutation.error);

  return (
    <form className="task-form" onSubmit={handleSubmit} noValidate>
      <h3>تأجيل الجلسة</h3>

      <p className="hint">
        تُسجَّل هذه الجلسة كمؤجلة، وتُنشأ جلسة جديدة بالموعد التالي إن كان
        معلوماً. الجلسة الأصلية تبقى في السجل كما هي.
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="field">
        <label htmlFor={`adjourn-notes-${hearing.id}`}>سبب التأجيل</label>
        <textarea
          id={`adjourn-notes-${hearing.id}`}
          rows={2}
          value={notes}
          disabled={mutation.isPending}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      <div className="task-form-row-inline">
        <div className="field">
          <label htmlFor={`adjourn-when-${hearing.id}`}>
            موعد الجلسة التالية — اختياري
          </label>
          <input
            id={`adjourn-when-${hearing.id}`}
            type="datetime-local"
            value={scheduledAt}
            disabled={mutation.isPending}
            onChange={(event) => setScheduledAt(event.target.value)}
          />
          <p className="hint">
            اتركه فارغاً إذا أُجّلت الجلسة إلى أجل غير مسمى.
          </p>
        </div>

        <div className="field">
          <label htmlFor={`adjourn-type-${hearing.id}`}>
            نوع الجلسة التالية
          </label>
          <select
            id={`adjourn-type-${hearing.id}`}
            value={hearingType}
            disabled={mutation.isPending || scheduledAt === ""}
            onChange={(event) =>
              setHearingType(event.target.value as HearingType)
            }
          >
            {HEARING_TYPES.map((value) => (
              <option key={value} value={value}>
                {HEARING_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`adjourn-circuit-${hearing.id}`}>
            الدائرة — اختياري
          </label>
          <input
            id={`adjourn-circuit-${hearing.id}`}
            type="text"
            value={circuit}
            disabled={mutation.isPending || scheduledAt === ""}
            onChange={(event) => setCircuit(event.target.value)}
          />
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "جارٍ الحفظ…" : "تسجيل التأجيل"}
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

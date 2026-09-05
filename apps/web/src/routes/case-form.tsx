import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "../lib/api.js";
import { useClientOptions } from "../lib/clients.js";
import { CASE_STATUSES, STATUS_LABELS, type CaseStatus } from "../lib/cases.js";

/**
 * The fields shared by opening a case and editing one.
 *
 * `clientId` and `caseNumber` are present only in create mode, and their
 * absence from edit is deliberate rather than an oversight:
 *
 *   * **The client.** Moving a matter to a different client is not an edit to a
 *     field, it is a re-filing. Every case activity, document, invoice and audit
 *     entry already recorded against this case describes work done for one
 *     client; changing the client silently rewrites what all of them mean,
 *     without touching any of them. If a firm needs it, it deserves its own
 *     operation with its own confirmation and its own audit action — not a
 *     select that looks like the others. The repository agrees: `clientId` is
 *     absent from `UpdateCaseInput` too, so the API would refuse it.
 *
 *   * **The case number.** This is the firm's own file reference. By the time
 *     anyone edits a case it is printed on filings, quoted in correspondence,
 *     and on paper in a physical folder; changing it in the system leaves the
 *     record and the paper trail disagreeing, and nothing warns anyone. Unlike
 *     the client, the API *does* permit it — the correction of a genuine typo
 *     has to be possible somewhere — so this is a restriction of the interface,
 *     not of the platform. Renumbering should be an administrative act somebody
 *     chooses, not a field that happens to be sitting on the everyday form.
 */

export interface CaseFormValues {
  clientId: string;
  caseNumber: string;
  titleAr: string;
  title: string;
  caseType: string;
  court: string;
  status: CaseStatus;
}

export const EMPTY_CASE_FORM: CaseFormValues = {
  clientId: "",
  caseNumber: "",
  titleAr: "",
  title: "",
  caseType: "",
  court: "",
  status: "open",
};

type FieldErrors = Partial<Record<keyof CaseFormValues, string>>;

/**
 * The same rules the API's Zod schemas enforce, restated here so a mistake is
 * caught before a round trip and lands on the field it belongs to.
 *
 * This is a copy, and a copy can drift. It is worth it anyway: the server is
 * still the authority — every one of these is enforced there too — and the
 * alternative is a form whose only feedback is a single "something was wrong"
 * after a request. The lengths and the required set mirror
 * apps/api/src/cases/dto.ts; a change there should be made here.
 */
function validate(values: CaseFormValues, mode: Mode): FieldErrors {
  const errors: FieldErrors = {};
  const required = "هذا الحقل مطلوب.";
  const tooLong = (max: number) => `الحد الأقصى ${max} حرفاً.`;

  if (mode === "create") {
    if (!values.clientId) errors.clientId = "اختر العميل.";
    if (!values.caseNumber.trim()) errors.caseNumber = required;
    else if (values.caseNumber.trim().length > 64)
      errors.caseNumber = tooLong(64);
  }

  if (!values.titleAr.trim()) errors.titleAr = required;
  else if (values.titleAr.trim().length > 500) errors.titleAr = tooLong(500);

  if (values.title.trim().length > 500) errors.title = tooLong(500);

  if (!values.caseType.trim()) errors.caseType = required;
  else if (values.caseType.trim().length > 100) errors.caseType = tooLong(100);

  if (values.court.trim().length > 200) errors.court = tooLong(200);

  return errors;
}

type Mode = "create" | "edit";

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
      {error && (
        // Tied to the control by aria-describedby at the call site, and
        // announced when it appears rather than only when focus reaches it.
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function CaseForm({
  mode,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  mode: Mode;
  initial: CaseFormValues;
  submitLabel: string;
  onSubmit: (values: CaseFormValues) => void;
  onCancel?: () => void;
  pending: boolean;
  error: unknown;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});

  // Only fetched where there is a select to fill. In edit mode the client is
  // not shown at all, so requesting the list would be a needless 403 for anyone
  // who holds cases.edit without clients.view.
  const clients = useClientOptions(mode === "create");

  const set = <K extends keyof CaseFormValues>(
    key: K,
    value: CaseFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
    // Clearing on edit rather than revalidating on every keystroke: the message
    // goes away as soon as the person acts on it, and does not reappear until
    // they ask for it by submitting again.
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  /**
   * Server errors placed on the field they concern.
   *
   * Only two can be attributed with certainty, and both are attributed by
   * status rather than by parsing a message:
   *
   *   409 — the case number is already used in this firm. It is the only
   *         unique constraint this form can violate.
   *   404 — on create, the client named is not one this firm has. The API
   *         answers 404 for a client that does not exist and for another
   *         firm's alike, and that is the point; the message says the client
   *         is unavailable rather than guessing which.
   *
   * A 400 carries no field detail — the validation pipe returns an empty body
   * on purpose — so it becomes a form-level message. The client-side rules
   * above are what make per-field feedback the normal case rather than the
   * exception.
   */
  const serverFieldErrors: FieldErrors = {};
  let formError: string | null = null;

  if (error instanceof ApiError) {
    if (error.status === 409) {
      serverFieldErrors.caseNumber =
        "رقم القضية مستخدم بالفعل في هذا المكتب. اختر رقماً آخر.";
    } else if (error.status === 404 && mode === "create") {
      serverFieldErrors.clientId = "هذا العميل غير متاح. اختر عميلاً آخر.";
    } else if (error.status === 400) {
      formError = "تعذّر حفظ القضية. راجع الحقول ثم حاول مرة أخرى.";
    } else if (error.status === 403) {
      formError =
        mode === "create"
          ? "لا تملك صلاحية إنشاء القضايا."
          : "لا تملك صلاحية تعديل القضايا.";
    } else {
      formError = "تعذّر حفظ القضية. حاول مرة أخرى.";
    }
  } else if (error) {
    formError = "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى.";
  }

  const shown: FieldErrors = { ...serverFieldErrors, ...errors };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const found = validate(values, mode);
    setErrors(found);

    if (Object.keys(found).length > 0) {
      return;
    }

    onSubmit(values);
  }

  const describedBy = (key: keyof CaseFormValues) =>
    shown[key] ? `case-${key}-error` : undefined;

  return (
    <form onSubmit={handleSubmit} noValidate>
      {formError && (
        <p className="error" role="alert">
          {formError}
        </p>
      )}

      {mode === "create" && (
        <Field id="case-clientId" label="العميل" error={shown.clientId}>
          {clients.isError ? (
            <p className="state denied">
              لا تملك صلاحية عرض العملاء، وهي لازمة لاختيار عميل للقضية. راجع
              مدير المكتب لمنحك صلاحية «عرض العملاء».
            </p>
          ) : (
            <select
              id="case-clientId"
              value={values.clientId}
              aria-describedby={describedBy("clientId")}
              disabled={clients.isPending}
              onChange={(event) => set("clientId", event.target.value)}
            >
              <option value="">
                {clients.isPending ? "جارٍ التحميل…" : "— اختر العميل —"}
              </option>
              {(clients.data ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.nameAr}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      {mode === "create" && (
        <Field
          id="case-caseNumber"
          label="رقم القضية"
          error={shown.caseNumber}
          hint="مرجع المكتب للقضية. لا يمكن تغييره بعد الإنشاء."
        >
          <input
            id="case-caseNumber"
            // Digits and separators: an ltr run, so the caret and the order
            // behave as the person typing expects.
            dir="ltr"
            value={values.caseNumber}
            aria-describedby={describedBy("caseNumber")}
            onChange={(event) => set("caseNumber", event.target.value)}
          />
        </Field>
      )}

      <Field id="case-titleAr" label="العنوان (عربي)" error={shown.titleAr}>
        <input
          id="case-titleAr"
          value={values.titleAr}
          aria-describedby={describedBy("titleAr")}
          onChange={(event) => set("titleAr", event.target.value)}
        />
      </Field>

      <Field
        id="case-title"
        label="العنوان (لاتيني) — اختياري"
        error={shown.title}
      >
        <input
          id="case-title"
          dir="ltr"
          value={values.title}
          aria-describedby={describedBy("title")}
          onChange={(event) => set("title", event.target.value)}
        />
      </Field>

      <Field id="case-caseType" label="نوع القضية" error={shown.caseType}>
        <input
          id="case-caseType"
          value={values.caseType}
          aria-describedby={describedBy("caseType")}
          onChange={(event) => set("caseType", event.target.value)}
        />
      </Field>

      <Field id="case-court" label="المحكمة — اختياري" error={shown.court}>
        <input
          id="case-court"
          value={values.court}
          aria-describedby={describedBy("court")}
          onChange={(event) => set("court", event.target.value)}
        />
      </Field>

      <Field id="case-status" label="الحالة">
        <select
          id="case-status"
          value={values.status}
          onChange={(event) => set("status", event.target.value as CaseStatus)}
        >
          {CASE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status].label}
            </option>
          ))}
        </select>
      </Field>

      <div className="form-actions">
        <button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : submitLabel}
        </button>

        {onCancel && (
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={onCancel}
          >
            إلغاء
          </button>
        )}
      </div>
    </form>
  );
}

/** Trims, and turns the empty optional fields into the nulls the API expects. */
export function toCaseBody(values: CaseFormValues) {
  return {
    titleAr: values.titleAr.trim(),
    title: values.title.trim() || null,
    caseType: values.caseType.trim(),
    court: values.court.trim() || null,
    status: values.status,
  };
}

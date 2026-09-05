import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "../lib/api.js";
import {
  CLIENT_TYPES,
  CLIENT_TYPE_LABELS,
  type ClientType,
} from "../lib/clients.js";

/**
 * Opening a client record, and editing one.
 *
 * **`clientType` is fixed after creation.** It is shown in edit mode as text,
 * not as a control, and the reasons are worth stating because "we could just
 * write the two columns" is the obvious objection:
 *
 *   * It re-identifies the client. The type decides which identifier the row
 *     carries, so changing it means clearing one and supplying another — and
 *     the row afterwards describes a different legal person from the row
 *     before. Every case filed against it, and every audit entry naming it,
 *     silently comes to mean something else without being touched.
 *   * It changes which unique index deduplicates the client. Companies are
 *     deduplicated on commercial registration and individuals on national ID,
 *     so the same real client can end up recorded twice with nothing objecting.
 *   * A company with representatives cannot become an individual at all. The
 *     representative rows reference `clients (firm_id, id, client_type)`, so
 *     PostgreSQL refuses the update outright.
 *   * The API refuses it regardless: `updateClientSchema` is `.strict()` and has
 *     no `clientType` key, so sending one is a 400 rather than a silently
 *     ignored field.
 *
 * The repair for a client entered as the wrong type is a new record and an
 * archive of the wrong one, which leaves both where a conflict check can still
 * see them. That is a deliberate act, not a select on the everyday form.
 */

const NATIONAL_ID = /^[12][0-9]{9}$/;
const COMMERCIAL_REGISTRATION = /^[0-9]{10}$/;
const VAT_NUMBER = /^3[0-9]{13}3$/;

export interface ClientFormValues {
  clientType: ClientType;
  nameAr: string;
  name: string;
  nationalId: string;
  commercialRegistration: string;
  vatNumber: string;
  phone: string;
  email: string;
  notes: string;
}

export const EMPTY_CLIENT_FORM: ClientFormValues = {
  clientType: "individual",
  nameAr: "",
  name: "",
  nationalId: "",
  commercialRegistration: "",
  vatNumber: "",
  phone: "",
  email: "",
  notes: "",
};

type FieldErrors = Partial<Record<keyof ClientFormValues, string>>;

/**
 * The same rules migration 0011 and apps/api/src/clients/dto.ts enforce.
 *
 * A copy, and copies drift — the server remains the authority and rejects
 * anything this misses. It earns its place by putting the message on the field
 * rather than leaving a bare 400 to be reported as "something was wrong": the
 * validation pipe returns no field detail, on purpose, so without this there is
 * nothing to attach.
 */
function validate(values: ClientFormValues): FieldErrors {
  const errors: FieldErrors = {};
  const required = "هذا الحقل مطلوب.";
  const tooLong = (max: number) => `الحد الأقصى ${max} حرفاً.`;

  if (!values.nameAr.trim()) errors.nameAr = required;
  else if (values.nameAr.trim().length > 300) errors.nameAr = tooLong(300);

  if (values.name.trim().length > 300) errors.name = tooLong(300);

  if (values.clientType === "individual") {
    if (!values.nationalId.trim()) errors.nationalId = required;
    else if (!NATIONAL_ID.test(values.nationalId.trim())) {
      errors.nationalId =
        "رقم الهوية أو الإقامة من 10 أرقام ويبدأ بـ 1 للمواطن أو 2 للمقيم.";
    }
  } else {
    if (!values.commercialRegistration.trim()) {
      errors.commercialRegistration = required;
    } else if (
      !COMMERCIAL_REGISTRATION.test(values.commercialRegistration.trim())
    ) {
      errors.commercialRegistration = "السجل التجاري من 10 أرقام.";
    }

    if (
      values.vatNumber.trim() &&
      !VAT_NUMBER.test(values.vatNumber.trim())
    ) {
      errors.vatNumber =
        "الرقم الضريبي من 15 رقماً يبدأ وينتهي بـ 3.";
    }
  }

  if (values.phone.trim().length > 40) errors.phone = tooLong(40);

  if (values.email.trim()) {
    if (values.email.trim().length > 320) errors.email = tooLong(320);
    else if (!values.email.includes("@")) {
      errors.email = "بريد إلكتروني غير صالح.";
    }
  }

  if (values.notes.trim().length > 5000) errors.notes = tooLong(5000);

  return errors;
}

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
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ClientForm({
  mode,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  mode: "create" | "edit";
  initial: ClientFormValues;
  submitLabel: string;
  onSubmit: (values: ClientFormValues) => void;
  onCancel?: () => void;
  pending: boolean;
  error: unknown;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});

  const set = <K extends keyof ClientFormValues>(
    key: K,
    value: ClientFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  /**
   * A 409 names the field it concerns, without the API having to.
   *
   * The response is a bare 409 — `ConflictException` carries no body — but no
   * information is missing, because the type determines which unique index is
   * even reachable. An individual carries a national ID and no commercial
   * registration, a company the reverse, and the CHECK constraint makes any
   * other combination unstorable. So there is exactly one identifier that can
   * collide, and it is known from the form itself.
   *
   * The VAT number has no unique index, so it can never be the cause.
   */
  const serverFieldErrors: FieldErrors = {};
  let formError: string | null = null;

  if (error instanceof ApiError) {
    if (error.status === 409) {
      if (values.clientType === "individual") {
        serverFieldErrors.nationalId =
          "رقم الهوية مسجَّل لعميل آخر في هذا المكتب.";
      } else {
        serverFieldErrors.commercialRegistration =
          "السجل التجاري مسجَّل لعميل آخر في هذا المكتب.";
      }
    } else if (error.status === 400) {
      formError = "تعذّر حفظ العميل. راجع الحقول ثم حاول مرة أخرى.";
    } else if (error.status === 403) {
      formError = "لا تملك صلاحية إدارة العملاء.";
    } else if (error.status === 404) {
      formError = "لم يعد هذا العميل متاحاً.";
    } else {
      formError = "تعذّر حفظ العميل. حاول مرة أخرى.";
    }
  } else if (error) {
    formError = "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى.";
  }

  const shown: FieldErrors = { ...serverFieldErrors, ...errors };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const found = validate(values);
    setErrors(found);

    if (Object.keys(found).length === 0) {
      onSubmit(values);
    }
  }

  const describedBy = (key: keyof ClientFormValues) =>
    shown[key] ? `client-${key}-error` : undefined;

  return (
    <form onSubmit={handleSubmit} noValidate>
      {formError && (
        <p className="error" role="alert">
          {formError}
        </p>
      )}

      <Field id="client-clientType" label="نوع العميل">
        {mode === "create" ? (
          <select
            id="client-clientType"
            value={values.clientType}
            onChange={(event) =>
              // Switching type changes which identifier applies. The other
              // one's value is dropped rather than kept out of sight, so a
              // half-finished company cannot be submitted as an individual
              // carrying a commercial registration the API would reject.
              setValues((current) => ({
                ...current,
                clientType: event.target.value as ClientType,
                nationalId: "",
                commercialRegistration: "",
                vatNumber: "",
              }))
            }
          >
            {CLIENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {CLIENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        ) : (
          // Text, not a disabled control: a greyed-out select invites people to
          // look for the way to enable it. See the note at the top of this file.
          <p className="fixed-value">
            {CLIENT_TYPE_LABELS[values.clientType]}
            <span className="hint"> — لا يمكن تغيير نوع العميل بعد الإنشاء.</span>
          </p>
        )}
      </Field>

      <Field id="client-nameAr" label="الاسم (عربي)" error={shown.nameAr}>
        <input
          id="client-nameAr"
          value={values.nameAr}
          aria-describedby={describedBy("nameAr")}
          onChange={(event) => set("nameAr", event.target.value)}
        />
      </Field>

      <Field
        id="client-name"
        label="الاسم (لاتيني) — اختياري"
        error={shown.name}
      >
        <input
          id="client-name"
          dir="ltr"
          value={values.name}
          aria-describedby={describedBy("name")}
          onChange={(event) => set("name", event.target.value)}
        />
      </Field>

      {values.clientType === "individual" ? (
        <Field
          id="client-nationalId"
          label="رقم الهوية / الإقامة"
          error={shown.nationalId}
          hint="10 أرقام."
        >
          <input
            id="client-nationalId"
            dir="ltr"
            inputMode="numeric"
            value={values.nationalId}
            aria-describedby={describedBy("nationalId")}
            onChange={(event) => set("nationalId", event.target.value)}
          />
        </Field>
      ) : (
        <>
          <Field
            id="client-commercialRegistration"
            label="السجل التجاري"
            error={shown.commercialRegistration}
            hint="10 أرقام."
          >
            <input
              id="client-commercialRegistration"
              dir="ltr"
              inputMode="numeric"
              value={values.commercialRegistration}
              aria-describedby={describedBy("commercialRegistration")}
              onChange={(event) =>
                set("commercialRegistration", event.target.value)
              }
            />
          </Field>

          <Field
            id="client-vatNumber"
            label="الرقم الضريبي — اختياري"
            error={shown.vatNumber}
            hint="15 رقماً. تُسجَّل الشركات فوق حد الإيرادات فقط."
          >
            <input
              id="client-vatNumber"
              dir="ltr"
              inputMode="numeric"
              value={values.vatNumber}
              aria-describedby={describedBy("vatNumber")}
              onChange={(event) => set("vatNumber", event.target.value)}
            />
          </Field>
        </>
      )}

      <Field id="client-phone" label="الهاتف — اختياري" error={shown.phone}>
        <input
          id="client-phone"
          dir="ltr"
          value={values.phone}
          aria-describedby={describedBy("phone")}
          onChange={(event) => set("phone", event.target.value)}
        />
      </Field>

      <Field
        id="client-email"
        label="البريد الإلكتروني — اختياري"
        error={shown.email}
      >
        <input
          id="client-email"
          dir="ltr"
          type="email"
          value={values.email}
          aria-describedby={describedBy("email")}
          onChange={(event) => set("email", event.target.value)}
        />
      </Field>

      <Field id="client-notes" label="ملاحظات — اختياري" error={shown.notes}>
        <textarea
          id="client-notes"
          rows={3}
          value={values.notes}
          aria-describedby={describedBy("notes")}
          onChange={(event) => set("notes", event.target.value)}
        />
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

/** Trims, and turns empty optional fields into the nulls the API expects. */
export function toClientBody(values: ClientFormValues) {
  const optional = (value: string) => value.trim() || null;

  return {
    nameAr: values.nameAr.trim(),
    name: optional(values.name),
    phone: optional(values.phone),
    email: optional(values.email),
    notes: optional(values.notes),
    ...(values.clientType === "individual"
      ? { nationalId: values.nationalId.trim() }
      : {
          commercialRegistration: values.commercialRegistration.trim(),
          vatNumber: optional(values.vatNumber),
        }),
  };
}

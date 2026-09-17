import { useState, type FormEvent } from "react";
import { ApiError } from "../lib/api.js";
import {
  useAddRepresentative,
  useArchiveRepresentative,
  useUpdateRepresentative,
  type ClientRepresentative,
  type RepresentativeBody,
} from "../lib/clients.js";
import { formatDate } from "../lib/dates.js";

const NATIONAL_ID = /^[12][0-9]{9}$/;

interface Values {
  nameAr: string;
  name: string;
  nationalId: string;
  role: string;
}

const EMPTY: Values = { nameAr: "", name: "", nationalId: "", role: "" };

type Errors = Partial<Record<keyof Values, string>>;

function validate(values: Values): Errors {
  const errors: Errors = {};
  const required = "هذا الحقل مطلوب.";

  if (!values.nameAr.trim()) errors.nameAr = required;
  else if (values.nameAr.trim().length > 300) errors.nameAr = "الحد الأقصى 300 حرفاً.";

  if (values.name.trim().length > 300) errors.name = "الحد الأقصى 300 حرفاً.";

  // Optional here, unlike an individual client's — a firm often knows who signs
  // long before it holds their ID, and conflicts are checked against the
  // company's registration rather than this.
  if (values.nationalId.trim() && !NATIONAL_ID.test(values.nationalId.trim())) {
    errors.nationalId =
      "رقم الهوية أو الإقامة من 10 أرقام ويبدأ بـ 1 للمواطن أو 2 للمقيم.";
  }

  if (!values.role.trim()) errors.role = required;
  else if (values.role.trim().length > 200) errors.role = "الحد الأقصى 200 حرفاً.";

  return errors;
}

function toBody(values: Values): RepresentativeBody {
  return {
    nameAr: values.nameAr.trim(),
    name: values.name.trim() || null,
    nationalId: values.nationalId.trim() || null,
    role: values.role.trim(),
  };
}

function messageFor(error: unknown): string | null {
  if (error instanceof ApiError) {
    if (error.status === 403) return "لا تملك صلاحية إدارة العملاء.";
    if (error.status === 404) return "لم يعد هذا السجل متاحاً.";
    if (error.status === 400) return "راجع الحقول ثم حاول مرة أخرى.";
    return "تعذّر الحفظ. حاول مرة أخرى.";
  }

  if (error) {
    return "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى.";
  }

  return null;
}

function RepresentativeFields({
  idPrefix,
  values,
  errors,
  onChange,
}: {
  idPrefix: string;
  values: Values;
  errors: Errors;
  onChange: <K extends keyof Values>(key: K, value: Values[K]) => void;
}) {
  const field = (
    key: keyof Values,
    label: string,
    extra?: { dir?: "ltr" },
  ) => {
    const id = `${idPrefix}-${key}`;

    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          dir={extra?.dir}
          value={values[key]}
          aria-describedby={errors[key] ? `${id}-error` : undefined}
          onChange={(event) => onChange(key, event.target.value)}
        />
        {errors[key] && (
          <p className="field-error" id={`${id}-error`} role="alert">
            {errors[key]}
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      {field("nameAr", "الاسم (عربي)")}
      {field("name", "الاسم (لاتيني) — اختياري", { dir: "ltr" })}
      {field("nationalId", "رقم الهوية / الإقامة — اختياري", { dir: "ltr" })}
      {field("role", "الصفة")}
    </>
  );
}

/**
 * Representatives of a company client.
 *
 * Only companies have them, and that is enforced in the database rather than
 * here: the foreign key references `clients (firm_id, id, client_type)`, so a
 * representative of an individual cannot be written down at all. This component
 * is simply not rendered for an individual — there is nothing to show and no
 * form that could succeed.
 *
 * Archived representatives stay listed. Someone who has left the company still
 * signed the contracts they signed, and a list that hid them would make the
 * record harder to read rather than tidier.
 */
export function Representatives({
  clientId,
  representatives,
  canManage,
}: {
  clientId: string;
  representatives: ClientRepresentative[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);

  const active = representatives.filter((one) => one.archivedAt === null);
  const archived = representatives.filter((one) => one.archivedAt !== null);

  return (
    <section className="representatives">
      <header className="page-header">
        <h2>الممثلون</h2>
        {canManage && !adding && (
          <button type="button" onClick={() => setAdding(true)}>
            إضافة ممثل
          </button>
        )}
      </header>

      {adding && (
        <AddRepresentative
          clientId={clientId}
          onDone={() => setAdding(false)}
        />
      )}

      {representatives.length === 0 && !adding && (
        <p className="state empty">لا يوجد ممثلون مسجَّلون.</p>
      )}

      <ul className="representative-list">
        {[...active, ...archived].map((representative) => (
          <RepresentativeRow
            key={representative.id}
            representative={representative}
            canManage={canManage}
          />
        ))}
      </ul>
    </section>
  );
}

function AddRepresentative({
  clientId,
  onDone,
}: {
  clientId: string;
  onDone: () => void;
}) {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const add = useAddRepresentative(clientId);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const found = validate(values);
    setErrors(found);

    if (Object.keys(found).length > 0) return;

    add.mutate(toBody(values), { onSuccess: onDone });
  }

  const message = messageFor(add.error);

  return (
    <form className="representative-form" onSubmit={handleSubmit} noValidate>
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}

      <RepresentativeFields
        idPrefix="rep-new"
        values={values}
        errors={errors}
        onChange={(key, value) => {
          setValues((current) => ({ ...current, [key]: value }));
          setErrors((current) => ({ ...current, [key]: undefined }));
        }}
      />

      <div className="form-actions">
        <button type="submit" disabled={add.isPending}>
          {add.isPending ? "جارٍ الحفظ…" : "إضافة"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={add.isPending}
          onClick={onDone}
        >
          إلغاء
        </button>
      </div>
    </form>
  );
}

function RepresentativeRow({
  representative,
  canManage,
}: {
  representative: ClientRepresentative;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Values>({
    nameAr: representative.nameAr,
    name: representative.name ?? "",
    nationalId: representative.nationalId ?? "",
    role: representative.role,
  });
  const [errors, setErrors] = useState<Errors>({});

  const update = useUpdateRepresentative(representative.id);
  const archive = useArchiveRepresentative(representative.id);

  if (editing) {
    const message = messageFor(update.error);

    return (
      <li className="representative-form">
        <form
          onSubmit={(event) => {
            event.preventDefault();

            const found = validate(values);
            setErrors(found);

            if (Object.keys(found).length > 0) return;

            update.mutate(toBody(values), {
              onSuccess: () => {
                setEditing(false);
                update.reset();
              },
            });
          }}
          noValidate
        >
          {message && (
            <p className="error" role="alert">
              {message}
            </p>
          )}

          <RepresentativeFields
            idPrefix={`rep-${representative.id}`}
            values={values}
            errors={errors}
            onChange={(key, value) => {
              setValues((current) => ({ ...current, [key]: value }));
              setErrors((current) => ({ ...current, [key]: undefined }));
            }}
          />

          <div className="form-actions">
            <button type="submit" disabled={update.isPending}>
              {update.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={update.isPending}
              onClick={() => {
                setEditing(false);
                update.reset();
              }}
            >
              إلغاء
            </button>
          </div>
        </form>
      </li>
    );
  }

  const archiveMessage = messageFor(archive.error);

  return (
    <li className={representative.archivedAt ? "archived" : undefined}>
      <div className="representative-summary">
        <strong>{representative.nameAr}</strong>
        <span className="muted"> — {representative.role}</span>

        {representative.nationalId && (
          <>
            {/*
              The separator sits outside the ltr run, not inside it. A leading
              space within a left-to-right span is placed at that run's own
              start, which in a right-to-left line is its right edge — so it
              lands between the number and nothing, and the number butts up
              against the Arabic before it.
            */}
            <span className="muted"> · </span>
            <span dir="ltr" className="case-number">
              {representative.nationalId}
            </span>
          </>
        )}

        {representative.archivedAt && (
          <>
            <span className="muted"> · </span>
            <span
              className="badge"
              style={{ color: "#4a4a45", background: "#eeeeec" }}
            >
              مؤرشف — {formatDate(representative.archivedAt)}
            </span>
          </>
        )}
      </div>

      {canManage && (
        <div className="representative-actions">
          <button type="button" className="link" onClick={() => setEditing(true)}>
            تعديل
          </button>

          {/*
            No confirmation dialogue, deliberately. Archiving is reversible in
            principle and destroys nothing — the row and everything it signed
            stay readable — so a prompt would be friction without a risk behind
            it. Anything that actually destroyed a record would be a different
            matter, and this product has no such action.
          */}
          {!representative.archivedAt && (
            <button
              type="button"
              className="link"
              disabled={archive.isPending}
              onClick={() => archive.mutate(undefined)}
            >
              {archive.isPending ? "جارٍ الأرشفة…" : "أرشفة"}
            </button>
          )}
        </div>
      )}

      {archiveMessage && (
        <p className="field-error" role="alert">
          {archiveMessage}
        </p>
      )}
    </li>
  );
}

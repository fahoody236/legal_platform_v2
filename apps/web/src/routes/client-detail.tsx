import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { isApiError, isNetworkError } from "../lib/api.js";
import {
  CLIENT_TYPE_LABELS,
  useArchiveClient,
  useClient,
  useUpdateClient,
  type ClientWithRepresentatives,
} from "../lib/clients.js";
import { formatDate, formatDateTime } from "../lib/dates.js";
import { useHasPermission } from "../lib/session.js";
import {
  ClientForm,
  toClientBody,
  type ClientFormValues,
} from "./client-form.js";
import { Representatives } from "./representatives.js";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children ?? <span className="muted">غير مُسجَّل</span>}</dd>
    </>
  );
}

export function ClientDetailPage() {
  const { clientId } = useParams({ from: "/clients/$clientId" });
  const search = useSearch({ from: "/clients/$clientId" });
  const query = useClient(clientId);

  return (
    <main className="wide">
      <p className="back">
        <Link to="/clients" search={search}>
          ← العودة إلى قائمة العملاء
        </Link>
      </p>

      <ClientBody state={query} />
    </main>
  );
}

function ClientBody({ state }: { state: ReturnType<typeof useClient> }) {
  if (state.isPending) {
    return (
      <p className="state" role="status" aria-live="polite">
        جارٍ تحميل العميل…
      </p>
    );
  }

  const { error } = state;

  if (error) {
    /**
     * One message for both "no such client" and "another firm's client". The
     * API makes them the same 404 by construction — a client outside the firm
     * is not a row the server declines to return, it is one the query cannot
     * see — and saying anything more specific would invent a distinction the
     * server deliberately does not make.
     */
    if (isApiError(error, 404)) {
      return (
        <p className="state" role="alert">
          لم يتم العثور على هذا العميل.
        </p>
      );
    }

    if (isApiError(error, 403)) {
      return (
        <p className="state denied" role="alert">
          لا تملك صلاحية عرض العملاء. راجع مدير المكتب لمنحك صلاحية «عرض
          العملاء».
        </p>
      );
    }

    return (
      <p className="state error" role="alert">
        {isNetworkError(error)
          ? "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى."
          : "تعذّر تحميل العميل. حاول مرة أخرى."}
      </p>
    );
  }

  const record = state.data;

  if (!record) {
    return (
      <p className="state error" role="alert">
        تعذّر تحميل العميل. حاول مرة أخرى.
      </p>
    );
  }

  return <ClientDetail record={record} />;
}

/** The stored client, as the form's fields. */
function toFormValues(record: ClientWithRepresentatives): ClientFormValues {
  return {
    clientType: record.clientType,
    nameAr: record.nameAr,
    name: record.name ?? "",
    nationalId: record.nationalId ?? "",
    commercialRegistration: record.commercialRegistration ?? "",
    vatNumber: record.vatNumber ?? "",
    phone: record.phone ?? "",
    email: record.email ?? "",
    notes: record.notes ?? "",
  };
}

function ClientDetail({ record }: { record: ClientWithRepresentatives }) {
  const canManage = useHasPermission("clients.manage");
  const [editing, setEditing] = useState(false);
  const update = useUpdateClient(record.id);
  const archive = useArchiveClient(record.id);

  if (editing) {
    return (
      <article>
        <h1>تعديل العميل</h1>

        <ClientForm
          mode="edit"
          initial={toFormValues(record)}
          submitLabel="حفظ التعديلات"
          onSubmit={(values) =>
            update.mutate(toClientBody(values), {
              onSuccess: () => {
                setEditing(false);
                update.reset();
              },
            })
          }
          onCancel={() => {
            setEditing(false);
            // Discards a failed attempt's error, so reopening the form starts
            // clean rather than showing a complaint about a previous submission.
            update.reset();
          }}
          pending={update.isPending}
          error={update.error}
        />
      </article>
    );
  }

  return (
    <article>
      <header className="page-header">
        <h1>{record.nameAr}</h1>

        <div className="identity">
          <span className="badge" style={{ color: "#1f3d8f", background: "#e9eefb" }}>
            {CLIENT_TYPE_LABELS[record.clientType]}
          </span>

          {/*
            Hidden without clients.manage. The API refuses regardless — this
            only keeps buttons that cannot work off the screen.
          */}
          {canManage && (
            <>
              <button type="button" onClick={() => setEditing(true)}>
                تعديل
              </button>

              {!record.archivedAt && (
                <button
                  type="button"
                  className="secondary"
                  disabled={archive.isPending}
                  onClick={() => archive.mutate(undefined)}
                >
                  {archive.isPending ? "جارٍ الأرشفة…" : "أرشفة"}
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {record.archivedAt && (
        // Stated before the fields rather than among them: an archived record
        // is a different thing to be reading, not one more property of it.
        <p className="state denied" role="status">
          هذا العميل مؤرشف بتاريخ {formatDate(record.archivedAt)}. قضاياه تبقى
          محفوظة وقابلة للاطلاع.
        </p>
      )}

      {archive.error && (
        <p className="state error" role="alert">
          تعذّرت أرشفة العميل. حاول مرة أخرى.
        </p>
      )}

      <dl className="detail">
        <Field label="نوع العميل">{CLIENT_TYPE_LABELS[record.clientType]}</Field>
        <Field label="الاسم (عربي)">{record.nameAr}</Field>

        <Field label="الاسم (لاتيني)">
          {record.name && <span dir="ltr">{record.name}</span>}
        </Field>

        {record.clientType === "individual" ? (
          <Field label="رقم الهوية / الإقامة">
            {record.nationalId && (
              <span dir="ltr" className="case-number">
                {record.nationalId}
              </span>
            )}
          </Field>
        ) : (
          <>
            <Field label="السجل التجاري">
              {record.commercialRegistration && (
                <span dir="ltr" className="case-number">
                  {record.commercialRegistration}
                </span>
              )}
            </Field>

            <Field label="الرقم الضريبي">
              {record.vatNumber && (
                <span dir="ltr" className="case-number">
                  {record.vatNumber}
                </span>
              )}
            </Field>
          </>
        )}

        <Field label="الهاتف">
          {record.phone && <span dir="ltr">{record.phone}</span>}
        </Field>

        <Field label="البريد الإلكتروني">
          {record.email && <span dir="ltr">{record.email}</span>}
        </Field>

        <Field label="ملاحظات">{record.notes}</Field>
        <Field label="تاريخ الإضافة">{formatDateTime(record.createdAt)}</Field>

        <Field label="مؤرشف">
          {record.archivedAt ? `نعم — ${formatDate(record.archivedAt)}` : "لا"}
        </Field>
      </dl>

      {/*
        Only for companies. An individual has no representatives and cannot be
        given any — the composite foreign key makes it unrepresentable — so an
        empty section with an add button would offer an action that always fails.
      */}
      {record.clientType === "company" && (
        <Representatives
          clientId={record.id}
          representatives={record.representatives}
          canManage={canManage}
        />
      )}
    </article>
  );
}

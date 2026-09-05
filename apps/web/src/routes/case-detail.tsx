import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { isApiError, isNetworkError } from "../lib/api.js";
import {
  STATUS_LABELS,
  useCase,
  useUpdateCase,
  type CaseRow,
} from "../lib/cases.js";
import { formatDate, formatDateTime } from "../lib/dates.js";
import { useHasPermission } from "../lib/session.js";
import { CaseForm, toCaseBody, type CaseFormValues } from "./case-form.js";

/**
 * A field that may have no value.
 *
 * "Not recorded" is written out rather than left blank. An empty cell reads as
 * a rendering fault — the reader wonders whether the value exists and failed to
 * load — while a stated absence is information: this matter has no court
 * because it is advisory, this case is not yet assigned.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children ?? <span className="muted">غير مُسجَّل</span>}</dd>
    </>
  );
}

export function CaseDetailPage() {
  const { caseId } = useParams({ from: "/cases/$caseId" });

  // The filter and page the reader arrived from, carried in this route's own
  // URL rather than read out of history. That makes the back link work after a
  // reload, and makes a link to this page shareable without losing the context
  // it belongs to.
  const search = useSearch({ from: "/cases/$caseId" });

  const backTo = {
    to: "/cases",
    search: { status: search.status, offset: search.offset },
  } as const;

  const query = useCase(caseId);

  return (
    <main className="wide">
      <p className="back">
        <Link {...backTo}>← العودة إلى قائمة القضايا</Link>
      </p>

      <CaseBody state={query} />
    </main>
  );
}

function CaseBody({
  state,
}: {
  state: ReturnType<typeof useCase>;
}) {
  if (state.isPending) {
    return (
      <p className="state" role="status" aria-live="polite">
        جارٍ تحميل القضية…
      </p>
    );
  }

  const { error } = state;

  if (error) {
    /**
     * One message for both "no such case" and "another firm's case". The API
     * makes them the same 404 by construction — a case outside the firm is not
     * a row the server declines to return, it is one the query cannot see — and
     * saying anything more specific here would invent a distinction the server
     * deliberately does not make.
     */
    if (isApiError(error, 404)) {
      return (
        <p className="state" role="alert">
          لم يتم العثور على هذه القضية.
        </p>
      );
    }

    if (isApiError(error, 403)) {
      return (
        <p className="state denied" role="alert">
          لا تملك صلاحية عرض القضايا. راجع مدير المكتب لمنحك صلاحية «عرض
          القضايا».
        </p>
      );
    }

    // A request that never reached the server gets its own message, because the
    // action differs: check the connection and try again, rather than report a
    // fault that is not on this side.
    return (
      <p className="state error" role="alert">
        {isNetworkError(error)
          ? "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى."
          : "تعذّر تحميل القضية. حاول مرة أخرى."}
      </p>
    );
  }

  const record = state.data;

  if (!record) {
    return (
      <p className="state error" role="alert">
        تعذّر تحميل القضية. حاول مرة أخرى.
      </p>
    );
  }

  return <CaseDetail record={record} />;
}

/** The stored case, as the form's fields. */
function toFormValues(record: CaseRow): CaseFormValues {
  return {
    clientId: record.clientId,
    caseNumber: record.caseNumber,
    titleAr: record.titleAr,
    title: record.title ?? "",
    caseType: record.caseType,
    court: record.court ?? "",
    status: record.status,
  };
}

function CaseDetail({ record }: { record: CaseRow }) {
  const status = STATUS_LABELS[record.status];
  const canEdit = useHasPermission("cases.edit");
  const [editing, setEditing] = useState(false);
  const update = useUpdateCase(record.id);

  if (editing) {
    return (
      <article>
        <h1>تعديل القضية</h1>

        <CaseForm
          mode="edit"
          initial={toFormValues(record)}
          submitLabel="حفظ التعديلات"
          onSubmit={(values) =>
            update.mutate(toCaseBody(values), {
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
        <h1>{record.titleAr}</h1>
        <div className="identity">
          <span
            className="badge"
            style={{ color: status.colour, background: status.background }}
          >
            {status.label}
          </span>
          {/*
            Hidden without cases.edit. The API refuses regardless — this only
            keeps a button that cannot work off the screen.
          */}
          {canEdit && (
            <button type="button" onClick={() => setEditing(true)}>
              تعديل
            </button>
          )}
        </div>
      </header>

      {record.archivedAt && (
        // Stated before the fields rather than among them: an archived record is
        // a different thing to be reading, not one more property of it.
        <p className="state denied" role="status">
          هذه القضية مؤرشفة بتاريخ {formatDate(record.archivedAt)}.
        </p>
      )}

      <dl className="detail">
        <Field label="رقم القضية">
          {/* Digits and a slash: an ltr run, which without the tag would be
              reordered around the slash by the bidi algorithm. */}
          <span dir="ltr" className="case-number">
            {record.caseNumber}
          </span>
        </Field>

        <Field label="العنوان (عربي)">{record.titleAr}</Field>

        <Field label="العنوان (لاتيني)">
          {record.title && <span dir="ltr">{record.title}</span>}
        </Field>

        <Field label="العميل">{record.clientNameAr}</Field>
        <Field label="نوع القضية">{record.caseType}</Field>
        <Field label="المحكمة">{record.court}</Field>
        <Field label="الحالة">{status.label}</Field>
        <Field label="المحامي المسؤول">{record.assignedLawyerName}</Field>

        <Field label="تاريخ الفتح">{formatDateTime(record.openedAt)}</Field>

        <Field label="تاريخ الإغلاق">
          {record.closedAt && formatDateTime(record.closedAt)}
        </Field>

        <Field label="مؤرشفة">
          {record.archivedAt ? `نعم — ${formatDate(record.archivedAt)}` : "لا"}
        </Field>
      </dl>
    </article>
  );
}

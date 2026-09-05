import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useCreateCase } from "../lib/cases.js";
import { useHasPermission } from "../lib/session.js";
import {
  CaseForm,
  EMPTY_CASE_FORM,
  toCaseBody,
  type CaseFormValues,
} from "./case-form.js";

export function CaseNewPage() {
  const search = useSearch({ from: "/cases/new" });
  const navigate = useNavigate();
  const create = useCreateCase();
  const canCreate = useHasPermission("cases.create");

  const backTo = {
    to: "/cases",
    search: { status: search.status, offset: search.offset },
  } as const;

  function handleSubmit(values: CaseFormValues) {
    create.mutate(
      { ...toCaseBody(values), clientId: values.clientId, caseNumber: values.caseNumber.trim() },
      {
        onSuccess: (created) => {
          void navigate({
            to: "/cases/$caseId",
            params: { caseId: created.id },
            search: { status: search.status, offset: search.offset },
          });
        },
      },
    );
  }

  return (
    <main className="narrow">
      <p className="back">
        <Link {...backTo}>← العودة إلى قائمة القضايا</Link>
      </p>

      <h1>قضية جديدة</h1>

      {/*
        The route is reachable by typing its URL even without the permission —
        the button that leads here is hidden, which is an affordance, not a gate.
        Saying so plainly beats letting someone fill in a form that will be
        refused on submit. The API refuses either way.
      */}
      {canCreate ? (
        <CaseForm
          mode="create"
          initial={EMPTY_CASE_FORM}
          submitLabel="إنشاء القضية"
          onSubmit={handleSubmit}
          onCancel={() => void navigate(backTo)}
          pending={create.isPending}
          error={create.error}
        />
      ) : (
        <p className="state denied" role="alert">
          لا تملك صلاحية إنشاء القضايا. راجع مدير المكتب لمنحك صلاحية «إنشاء
          القضايا».
        </p>
      )}
    </main>
  );
}

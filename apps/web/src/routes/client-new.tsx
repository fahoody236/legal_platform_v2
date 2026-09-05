import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useCreateClient } from "../lib/clients.js";
import { useHasPermission } from "../lib/session.js";
import {
  ClientForm,
  EMPTY_CLIENT_FORM,
  toClientBody,
  type ClientFormValues,
} from "./client-form.js";

export function ClientNewPage() {
  const search = useSearch({ from: "/clients/new" });
  const navigate = useNavigate();
  const create = useCreateClient();
  const canManage = useHasPermission("clients.manage");

  const backTo = { to: "/clients", search } as const;

  function handleSubmit(values: ClientFormValues) {
    create.mutate(
      { ...toClientBody(values), clientType: values.clientType },
      {
        onSuccess: (created) => {
          void navigate({
            to: "/clients/$clientId",
            params: { clientId: created.id },
            search,
          });
        },
      },
    );
  }

  return (
    <main className="narrow">
      <p className="back">
        <Link {...backTo}>← العودة إلى قائمة العملاء</Link>
      </p>

      <h1>عميل جديد</h1>

      {/*
        Reachable by typing the URL even without the permission — the link that
        leads here is hidden, which is an affordance rather than a gate. Saying
        so plainly beats letting someone fill in a form that will be refused.
      */}
      {canManage ? (
        <ClientForm
          mode="create"
          initial={EMPTY_CLIENT_FORM}
          submitLabel="إنشاء العميل"
          onSubmit={handleSubmit}
          onCancel={() => void navigate(backTo)}
          pending={create.isPending}
          error={create.error}
        />
      ) : (
        <p className="state denied" role="alert">
          لا تملك صلاحية إدارة العملاء. راجع مدير المكتب لمنحك صلاحية «إدارة
          العملاء».
        </p>
      )}
    </main>
  );
}

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { isApiError } from "../lib/api.js";
import {
  CLIENT_TYPES,
  CLIENT_TYPE_LABELS,
  clientIdentifier,
  useClients,
  type Client,
  type ClientType,
} from "../lib/clients.js";
import { useHasPermission } from "../lib/session.js";
import { AppHeader } from "./app-header.js";

const PAGE_SIZE = 25;

export interface ClientsSearch {
  clientType?: ClientType | undefined;
  archived?: boolean | undefined;
  offset?: number | undefined;
}

export function ClientsPage() {
  const search = useSearch({ from: "/clients" });
  const navigate = useNavigate();
  const canManage = useHasPermission("clients.manage");

  const { clientType, archived } = search;
  const offset = search.offset ?? 0;

  const clients = useClients({
    clientType,
    archived,
    limit: PAGE_SIZE,
    offset,
  });

  function setSearch(next: ClientsSearch) {
    void navigate({ to: "/clients", search: next });
  }

  const total = clients.data?.total ?? 0;
  const lastOffset = Math.max(
    0,
    Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE,
  );
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <main className="wide">
      <AppHeader title="العملاء" />

      <div className="filters">
        <label htmlFor="clientType">النوع</label>
        <select
          id="clientType"
          value={clientType ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            setSearch({
              clientType: value === "" ? undefined : (value as ClientType),
              archived,
              // Back to the first page: page 3 of one filter is rarely page 3
              // of another, and staying there shows an empty table for a filter
              // that has results.
              offset: 0,
            });
          }}
        >
          <option value="">جميع الأنواع</option>
          {CLIENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {CLIENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>

        <label htmlFor="archived">الأرشفة</label>
        <select
          id="archived"
          value={archived === undefined ? "" : String(archived)}
          onChange={(event) => {
            const value = event.target.value;
            setSearch({
              clientType,
              archived: value === "" ? undefined : value === "true",
              offset: 0,
            });
          }}
        >
          <option value="">الجميع</option>
          <option value="false">النشطون</option>
          <option value="true">المؤرشفون</option>
        </select>

        {/*
          Hidden without clients.manage. The API refuses the request regardless;
          this only avoids offering an action that cannot succeed.
        */}
        {canManage && (
          <Link
            to="/clients/new"
            search={{ clientType, archived, offset }}
            className="button-link"
          >
            عميل جديد
          </Link>
        )}
      </div>

      <ClientsBody
        isPending={clients.isPending}
        error={clients.error}
        rows={clients.data?.clients ?? []}
        search={{ clientType, archived, offset }}
      />

      {clients.isSuccess && total > 0 && (
        <nav className="pagination" aria-label="التنقل بين الصفحات">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() =>
              setSearch({
                clientType,
                archived,
                offset: Math.max(0, offset - PAGE_SIZE),
              })
            }
          >
            السابق
          </button>

          {/* Numerals inside an Arabic sentence: the run is tagged ltr so
              "1–25" keeps its order rather than being reversed around the
              dash. */}
          <span className="page-count">
            <span dir="ltr">
              {pageStart}–{pageEnd}
            </span>{" "}
            من {total}
          </span>

          <button
            type="button"
            disabled={offset >= lastOffset}
            onClick={() =>
              setSearch({ clientType, archived, offset: offset + PAGE_SIZE })
            }
          >
            التالي
          </button>
        </nav>
      )}
    </main>
  );
}

function ClientsBody({
  isPending,
  error,
  rows,
  search,
}: {
  isPending: boolean;
  error: unknown;
  rows: Client[];
  search: ClientsSearch;
}) {
  if (isPending) {
    return (
      <p className="state" role="status" aria-live="polite">
        جارٍ تحميل العملاء…
      </p>
    );
  }

  if (isApiError(error, 403)) {
    return (
      <p className="state denied" role="alert">
        لا تملك صلاحية عرض العملاء. راجع مدير المكتب لمنحك صلاحية «عرض العملاء».
      </p>
    );
  }

  if (error) {
    return (
      <p className="state error" role="alert">
        تعذّر تحميل العملاء. حاول مرة أخرى.
      </p>
    );
  }

  if (rows.length === 0) {
    return <p className="state">لا يوجد عملاء مطابقون.</p>;
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">الاسم</th>
            <th scope="col">النوع</th>
            <th scope="col">المعرّف</th>
            <th scope="col">الحالة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ClientTableRow key={row.id} row={row} search={search} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The name is a real `<Link>`, and the whole row also navigates — the same
 * arrangement as the cases table, for the same reasons: the link carries the
 * keyboard path and the copyable target, the row click is the convenience.
 */
function ClientTableRow({
  row,
  search,
}: {
  row: Client;
  search: ClientsSearch;
}) {
  const navigate = useNavigate();

  const target = {
    to: "/clients/$clientId",
    params: { clientId: row.id },
    search,
  } as const;

  const identifier = clientIdentifier(row);

  return (
    <tr
      className="row-link"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a")) {
          return;
        }

        void navigate(target);
      }}
    >
      <td>
        <Link {...target}>{row.nameAr}</Link>
      </td>
      <td>{CLIENT_TYPE_LABELS[row.clientType]}</td>
      <td>
        {/* Digits: an ltr run, which without the tag would be reordered by the
            bidi algorithm within the surrounding Arabic. */}
        {identifier ? (
          <span dir="ltr" className="case-number">
            {identifier}
          </span>
        ) : (
          <span className="muted">غير مُسجَّل</span>
        )}
      </td>
      <td>
        {row.archivedAt ? (
          <span className="badge" style={{ color: "#4a4a45", background: "#eeeeec" }}>
            مؤرشف
          </span>
        ) : (
          <span className="badge" style={{ color: "#1f6b3a", background: "#e8f4ec" }}>
            نشط
          </span>
        )}
      </td>
    </tr>
  );
}

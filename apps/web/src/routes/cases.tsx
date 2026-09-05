import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { apiFetch, isApiError } from "../lib/api.js";
import {
  CASE_STATUSES,
  STATUS_LABELS,
  useCases,
  type CaseRow,
  type CaseStatus,
} from "../lib/cases.js";
import { displayName, useSession } from "../lib/session.js";
import { casesRoute } from "../router.js";

const PAGE_SIZE = 25;

/**
 * The lawyer column.
 *
 * The API resolves the name; the id stays in the payload for linking and
 * filtering later. Null means unassigned, which is a real state rather than
 * missing data, so it gets words rather than a blank cell.
 */
function LawyerName({ name }: { name: string | null }) {
  if (!name) {
    return <span className="muted">غير مُسند</span>;
  }

  return <>{name}</>;
}

function StatusBadge({ status }: { status: CaseStatus }) {
  const { label, colour, background } = STATUS_LABELS[status];

  return (
    <span className="badge" style={{ color: colour, background }}>
      {label}
    </span>
  );
}

export function CasesPage() {
  const search = useSearch({ from: casesRoute.id });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();

  const status = search.status;
  const offset = search.offset ?? 0;

  const cases = useCases({ status, limit: PAGE_SIZE, offset });

  function setSearch(next: { status?: CaseStatus | undefined; offset: number }) {
    // The filter and the page live in the URL, not in component state, so a
    // filtered page can be linked, bookmarked and reloaded — and the browser's
    // back button steps through filters the way people expect it to.
    void navigate({ to: "/cases", search: next });
  }

  async function signOut() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Already signed out, or unreachable. Either way the local answer is the
      // same, and there is nothing useful to say about a session that is gone.
    }

    queryClient.clear();
    void navigate({ to: "/login" });
  }

  const total = cases.data?.total ?? 0;
  const lastOffset = Math.max(0, Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE);
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <main className="wide">
      <header className="page-header">
        <h1>القضايا</h1>
        {session.data && (
          <div className="identity">
            <span>{displayName(session.data)}</span>
            <button type="button" className="link" onClick={signOut}>
              تسجيل الخروج
            </button>
          </div>
        )}
      </header>

      <div className="filters">
        <label htmlFor="status">الحالة</label>
        <select
          id="status"
          value={status ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            setSearch({
              status: value === "" ? undefined : (value as CaseStatus),
              // Back to the first page: page 3 of an unfiltered list is rarely
              // page 3 of a filtered one, and staying there shows an empty table
              // for a filter that has results.
              offset: 0,
            });
          }}
        >
          <option value="">جميع الحالات</option>
          {CASE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value].label}
            </option>
          ))}
        </select>
      </div>

      <CasesBody
        isPending={cases.isPending}
        error={cases.error}
        rows={cases.data?.cases ?? []}
      />

      {cases.isSuccess && total > 0 && (
        <nav className="pagination" aria-label="التنقل بين الصفحات">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() =>
              setSearch({ status, offset: Math.max(0, offset - PAGE_SIZE) })
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
            onClick={() => setSearch({ status, offset: offset + PAGE_SIZE })}
          >
            التالي
          </button>
        </nav>
      )}
    </main>
  );
}

function CasesBody({
  isPending,
  error,
  rows,
}: {
  isPending: boolean;
  error: unknown;
  rows: CaseRow[];
}) {
  if (isPending) {
    return (
      <p className="state" role="status" aria-live="polite">
        جارٍ تحميل القضايا…
      </p>
    );
  }

  /**
   * 403 is its own message. It is not an error the person can retry their way
   * out of, and telling them "something went wrong" would send them to look for
   * a fault that does not exist — the system is working exactly as configured,
   * and the thing they need to know is who can change that.
   */
  if (isApiError(error, 403)) {
    return (
      <p className="state denied" role="alert">
        لا تملك صلاحية عرض القضايا. راجع مدير المكتب لمنحك صلاحية «عرض القضايا».
      </p>
    );
  }

  if (error) {
    return (
      <p className="state error" role="alert">
        تعذّر تحميل القضايا. حاول مرة أخرى.
      </p>
    );
  }

  if (rows.length === 0) {
    return <p className="state">لا توجد قضايا مطابقة.</p>;
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">رقم القضية</th>
            <th scope="col">العنوان</th>
            <th scope="col">العميل</th>
            <th scope="col">النوع</th>
            <th scope="col">الحالة</th>
            <th scope="col">المحامي المسؤول</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {/* Digits and a slash: an ltr run, which without the tag would
                  be reordered around the slash by the bidi algorithm. */}
              <td dir="ltr" className="case-number">
                {row.caseNumber}
              </td>
              <td>{row.titleAr}</td>
              <td>{row.clientNameAr}</td>
              <td>{row.caseType}</td>
              <td>
                <StatusBadge status={row.status} />
              </td>
              <td>
                <LawyerName name={row.assignedLawyerName} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

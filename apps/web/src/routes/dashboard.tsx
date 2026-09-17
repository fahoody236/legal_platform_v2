import { Link } from "@tanstack/react-router";
import { isNetworkError } from "../lib/api.js";
import { CASE_STATUSES, STATUS_LABELS } from "../lib/cases.js";
import { useDashboard, type DashboardResponse } from "../lib/dashboard.js";
import { formatDate, formatDateTime } from "../lib/dates.js";
import { AppHeader } from "./app-header.js";

export function DashboardPage() {
  const dashboard = useDashboard();

  return (
    <main className="wide">
      <AppHeader title="لوحة المتابعة" />

      {dashboard.isPending && (
        <p className="state" role="status" aria-live="polite">
          جارٍ التحميل…
        </p>
      )}

      {dashboard.error && (
        <p className="state error" role="alert">
          {isNetworkError(dashboard.error)
            ? "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى."
            : "تعذّر تحميل لوحة المتابعة. حاول مرة أخرى."}
        </p>
      )}

      {dashboard.isSuccess && <Sections data={dashboard.data} />}
    </main>
  );
}

function Sections({ data }: { data: DashboardResponse }) {
  const nothing =
    !data.cases && !data.myTasks && !data.upcoming && !data.activity;

  if (nothing) {
    // Every section absent means every permission absent. Say so, rather than
    // showing a page that is merely blank.
    return (
      <p className="state denied" role="status">
        لا تملك صلاحية عرض أي من القضايا أو المهام أو العملاء. راجع مدير المكتب.
      </p>
    );
  }

  return (
    <div className="dashboard">
      {data.myTasks && <MyTasks data={data.myTasks} />}
      {data.cases && <CaseCounts data={data.cases} />}
      {data.upcoming && <Upcoming data={data.upcoming} />}
      {data.activity && <Activity data={data.activity} />}
    </div>
  );
}

/**
 * Three numbers, each a link to the list already filtered to show exactly the
 * tasks it counts. A number that cannot be clicked through to its rows is a
 * number nobody can check.
 */
function MyTasks({ data }: { data: NonNullable<DashboardResponse["myTasks"]> }) {
  return (
    <section className="panel">
      <h2>مهامي</h2>
      <div className="stats">
        <Link to="/tasks" search={{ mine: true }} className="stat">
          <span className="stat-value">{data.open}</span>
          <span className="stat-label">مفتوحة</span>
        </Link>
        <Link
          to="/tasks"
          search={{ mine: true, overdue: true }}
          className={data.overdue > 0 ? "stat stat-warn" : "stat"}
        >
          <span className="stat-value">{data.overdue}</span>
          <span className="stat-label">متأخرة</span>
        </Link>
        <Link to="/tasks" search={{ mine: true }} className="stat">
          <span className="stat-value">{data.dueSoon}</span>
          <span className="stat-label">
            تستحق خلال {data.dueSoonDays} أيام
          </span>
        </Link>
      </div>
    </section>
  );
}

function CaseCounts({ data }: { data: NonNullable<DashboardResponse["cases"]> }) {
  return (
    <section className="panel">
      <h2>
        القضايا <span className="muted">— {data.total} نشطة</span>
      </h2>
      {data.total === 0 ? (
        <p className="state">لا توجد قضايا نشطة.</p>
      ) : (
        <div className="stats">
          {CASE_STATUSES.map((status) => (
            <Link
              key={status}
              to="/cases"
              search={{ status }}
              className="stat"
              style={{ borderInlineStartColor: STATUS_LABELS[status].colour }}
            >
              <span className="stat-value">{data.byStatus[status]}</span>
              <span className="stat-label">{STATUS_LABELS[status].label}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function Upcoming({ data }: { data: NonNullable<DashboardResponse["upcoming"]> }) {
  return (
    <section className="panel">
      <h2>
        مواعيد قادمة{" "}
        <span className="muted">— خلال {data.windowDays} يوماً</span>
      </h2>

      {data.items.length === 0 ? (
        <p className="state">لا توجد مواعيد خلال الفترة القادمة.</p>
      ) : (
        <ul className="plain-list">
          {data.items.map((item) => (
            <li key={item.caseId} className="upcoming-row">
              <span className="upcoming-date">{formatDate(item.dueAt)}</span>
              <span className="upcoming-body">
                <Link
                  to="/cases/$caseId"
                  params={{ caseId: item.caseId }}
                  search={{}}
                >
                  <span dir="ltr" className="case-number">
                    {item.caseNumber}
                  </span>
                  {" — "}
                  {item.caseTitleAr}
                </Link>
                <span className="muted">
                  {" · "}
                  {item.taskTitleAr}
                  {item.taskAssignedToName && ` · ${item.taskAssignedToName}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The sentence and the actor, side by side. The sentence is a verbal noun with
 * no subject, so it does not have to agree with anyone — see the API's
 * activity-text.ts for why that matters in Arabic.
 */
function Activity({ data }: { data: NonNullable<DashboardResponse["activity"]> }) {
  return (
    <section className="panel">
      <h2>آخر النشاط</h2>

      {data.items.length === 0 ? (
        <p className="state">لا يوجد نشاط مسجَّل بعد.</p>
      ) : (
        <ul className="plain-list">
          {data.items.map((entry) => (
            <li key={entry.id} className="activity-row">
              <span className="activity-when muted">
                {formatDateTime(entry.occurredAt)}
              </span>
              <span className="activity-body">
                {entry.link ? (
                  entry.link.type === "case" ? (
                    <Link
                      to="/cases/$caseId"
                      params={{ caseId: entry.link.id }}
                      search={{}}
                    >
                      {entry.text}
                    </Link>
                  ) : (
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: entry.link.id }}
                      search={{}}
                    >
                      {entry.text}
                    </Link>
                  )
                ) : (
                  entry.text
                )}
                <span className="muted">
                  {" · "}
                  {entry.actor
                    ? entry.actor.disabled
                      ? `${entry.actor.name} (معطّل)`
                      : entry.actor.name
                    : "غير مصادق"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

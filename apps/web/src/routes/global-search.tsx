import { useNavigate } from "@tanstack/react-router";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { isNetworkError } from "../lib/api.js";
import { STATUS_LABELS } from "../lib/cases.js";
import { CLIENT_TYPE_LABELS } from "../lib/clients.js";
import {
  SEARCH_MIN_LENGTH,
  useGlobalSearch,
  type SearchResponse,
} from "../lib/search.js";
import { TASK_STATUS_LABELS } from "../lib/tasks.js";
import { useDebounced } from "../lib/use-debounced.js";

const DEBOUNCE_MS = 300;

/**
 * One result, flattened out of its group so the keyboard can walk a single
 * list. `group` is kept so the row can render its own shape and so the group
 * heading can be emitted when it changes.
 */
interface Row {
  key: string;
  group: "clients" | "cases" | "tasks";
  primary: string;
  secondary: string;
  /** Latin or numeric text that needs an ltr run of its own. */
  ltr?: string | undefined;
  archived: boolean;
  to: { to: "/clients/$clientId"; params: { clientId: string } }
    | { to: "/cases/$caseId"; params: { caseId: string } };
}

const GROUP_LABELS = {
  clients: "العملاء",
  cases: "القضايا",
  tasks: "المهام",
} as const;

/**
 * Groups ordered by their best hit, so a national ID puts the clients group
 * first and a case number puts cases first. Ties break to the fixed order —
 * cases, clients, tasks — which is also the order shown when nothing
 * distinguishes them.
 */
function flatten(response: SearchResponse | undefined): Row[] {
  if (!response) return [];

  const groups: Array<{ name: Row["group"]; best: number; rows: Row[] }> = [];

  if (response.cases) {
    groups.push({
      name: "cases",
      best: response.cases.items[0]?.rank ?? Infinity,
      rows: response.cases.items.map((hit) => ({
        key: `case-${hit.id}`,
        group: "cases",
        primary: hit.titleAr,
        secondary: `${hit.clientNameAr} · ${STATUS_LABELS[hit.status].label}`,
        ltr: hit.caseNumber,
        archived: hit.archivedAt !== null,
        to: { to: "/cases/$caseId", params: { caseId: hit.id } },
      })),
    });
  }

  if (response.clients) {
    groups.push({
      name: "clients",
      best: response.clients.items[0]?.rank ?? Infinity,
      rows: response.clients.items.map((hit) => ({
        key: `client-${hit.id}`,
        group: "clients",
        primary: hit.nameAr,
        secondary: CLIENT_TYPE_LABELS[hit.clientType],
        ltr: hit.identifier ?? undefined,
        archived: hit.archivedAt !== null,
        to: { to: "/clients/$clientId", params: { clientId: hit.id } },
      })),
    });
  }

  if (response.tasks) {
    groups.push({
      name: "tasks",
      best: response.tasks.items[0]?.rank ?? Infinity,
      rows: response.tasks.items.map((hit) => ({
        key: `task-${hit.id}`,
        group: "tasks",
        primary: hit.titleAr,
        secondary: TASK_STATUS_LABELS[hit.status].label,
        ltr: hit.caseNumber,
        archived: false,
        // A task has no page of its own; it lives on its case.
        to: { to: "/cases/$caseId", params: { caseId: hit.caseId } },
      })),
    });
  }

  const order: Record<Row["group"], number> = { cases: 0, clients: 1, tasks: 2 };

  return groups
    .sort((a, b) => a.best - b.best || order[a.name] - order[b.name])
    .flatMap((group) => group.rows);
}

export function GlobalSearch() {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebounced(term, DEBOUNCE_MS);
  const results = useGlobalSearch(debounced);
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const rows = useMemo(() => flatten(results.data), [results.data]);

  // The term the results describe, not the one being typed, so "no results" is
  // never announced against a half-typed word.
  const settled = debounced.trim();
  const searching = settled.length >= SEARCH_MIN_LENGTH;

  const totals = results.data
    ? Object.values(results.data).reduce((sum, group) => sum + group.total, 0)
    : 0;

  const groupsVisible = results.data ? Object.keys(results.data).length : 0;

  // A fresh result set resets the highlight; an index into the old list means
  // nothing against the new one.
  useEffect(() => setActive(-1), [results.data]);

  // Click outside closes. Listening on the document rather than blurring the
  // input, because clicking a result *is* clicking outside the input.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function go(row: Row) {
    setOpen(false);
    setTerm("");
    void navigate({ ...row.to, search: {} });
  }

  /**
   * The keyboard contract: arrows move, Enter opens, Escape closes. The input
   * keeps focus throughout — it is a combobox, and the list is described to
   * assistive technology through aria-activedescendant rather than by moving
   * focus into it, which would take the caret away from the person typing.
   */
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }

    if (!open || rows.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current + 1) % rows.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current <= 0 ? rows.length - 1 : current - 1));
    } else if (event.key === "Enter") {
      const row = rows[active];
      if (row) {
        event.preventDefault();
        go(row);
      }
    }
  }

  const listboxOpen = open && term.trim().length > 0;

  return (
    <div className="global-search" ref={rootRef}>
      <input
        type="search"
        role="combobox"
        aria-label="البحث"
        aria-expanded={listboxOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          active >= 0 && rows[active] ? `${listId}-${rows[active].key}` : undefined
        }
        autoComplete="off"
        placeholder="ابحث في العملاء والقضايا والمهام…"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {listboxOpen && (
        <div className="search-popover">
          {term.trim().length < SEARCH_MIN_LENGTH && (
            <p className="hint">اكتب حرفين على الأقل للبحث.</p>
          )}

          {searching && results.isPending && (
            <p className="hint" role="status">
              جارٍ البحث…
            </p>
          )}

          {searching && results.error && (
            <p className="field-error" role="alert">
              {isNetworkError(results.error)
                ? "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى."
                : "تعذّر البحث. حاول مرة أخرى."}
            </p>
          )}

          {searching && results.isSuccess && rows.length === 0 && (
            <p className="hint">
              {groupsVisible === 0
                ? "لا تملك صلاحية عرض أي من العملاء أو القضايا أو المهام."
                : "لا توجد نتائج مطابقة."}
            </p>
          )}

          <ul id={listId} role="listbox" className="search-groups">
            {rows.map((row, index) => {
              const first = index === 0 || rows[index - 1]?.group !== row.group;
              const group = results.data?.[row.group];

              return (
                <li key={row.key} role="presentation">
                  {first && (
                    <div className="search-group-label" role="presentation">
                      {GROUP_LABELS[row.group]}
                      {group && group.total > group.items.length && (
                        <span className="muted">
                          {" "}
                          — أول {group.items.length} من {group.total}
                        </span>
                      )}
                    </div>
                  )}

                  <div
                    id={`${listId}-${row.key}`}
                    role="option"
                    aria-selected={index === active}
                    className={index === active ? "search-row active" : "search-row"}
                    // Mouse users get the same behaviour as Enter. onMouseDown
                    // rather than onClick, so it fires before the input blurs.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      go(row);
                    }}
                    onMouseEnter={() => setActive(index)}
                  >
                    <span className="search-primary">
                      {row.primary}
                      {row.archived && (
                        <span className="badge" style={{ color: "#4a4a45", background: "#eeeeec" }}>
                          مؤرشف
                        </span>
                      )}
                    </span>
                    <span className="search-secondary muted">
                      {row.ltr && (
                        <>
                          <span dir="ltr" className="case-number">
                            {row.ltr}
                          </span>
                          {" · "}
                        </>
                      )}
                      {row.secondary}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          {searching && results.isSuccess && totals > rows.length && (
            <p className="hint">
              تظهر أول النتائج فقط. ضيّق البحث للوصول إلى الباقي.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

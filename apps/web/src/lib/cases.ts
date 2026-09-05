import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./api.js";

/** Mirrors CASE_STATUSES in packages/db. The API rejects anything else. */
export const CASE_STATUSES = [
  "open",
  "in_progress",
  "pending",
  "closed",
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

/**
 * The Arabic label and colour for each status.
 *
 * Colour carries no information on its own — every row states the status in
 * words, and the colour only reinforces it. A status distinguishable *only* by
 * colour is unreadable to anyone who cannot separate these hues, and this is a
 * table someone reads all day.
 */
export const STATUS_LABELS: Record<
  CaseStatus,
  { label: string; colour: string; background: string }
> = {
  open: { label: "مفتوحة", colour: "#1f6b3a", background: "#e8f4ec" },
  in_progress: { label: "قيد النظر", colour: "#1f3d8f", background: "#e9eefb" },
  pending: { label: "معلّقة", colour: "#8a5a06", background: "#fdf3e3" },
  closed: { label: "مغلقة", colour: "#4a4a45", background: "#eeeeec" },
};

export interface CaseRow {
  id: string;
  caseNumber: string;
  titleAr: string;
  title: string | null;
  caseType: string;
  court: string | null;
  status: CaseStatus;
  clientId: string;
  /** Resolved by the API. Always present: every case has a client. */
  clientNameAr: string;
  assignedLawyerId: string | null;
  /** Arabic name where recorded, Latin otherwise. Null when unassigned. */
  assignedLawyerName: string | null;
  openedAt: string;
  closedAt: string | null;
  archivedAt: string | null;
}

export interface CasesPage {
  cases: CaseRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface CasesQuery {
  status?: CaseStatus | undefined;
  limit: number;
  offset: number;
}

/**
 * Not retried on 401, 403 or 404. Each is a settled answer about this request,
 * not a fault that a second attempt could resolve, and retrying only delays the
 * message the person needs to read.
 */
function retryUnlessAnswered(failureCount: number, error: Error): boolean {
  const status = (error as { status?: number }).status;

  if (status === 401 || status === 403 || status === 404) {
    return false;
  }

  return failureCount < 2;
}

export function useCase(caseId: string): UseQueryResult<CaseRow> {
  return useQuery({
    queryKey: ["case", caseId],
    queryFn: async () => {
      const body = await apiFetch<{ case: CaseRow }>(
        `/api/cases/${encodeURIComponent(caseId)}`,
      );
      return body.case;
    },
    retry: retryUnlessAnswered,
  });
}

export function useCases(query: CasesQuery): UseQueryResult<CasesPage> {
  const search = new URLSearchParams({
    limit: String(query.limit),
    offset: String(query.offset),
  });

  if (query.status) {
    search.set("status", query.status);
  }

  return useQuery({
    queryKey: ["cases", query.status ?? null, query.limit, query.offset],
    queryFn: () => apiFetch<CasesPage>(`/api/cases?${search.toString()}`),
    retry: retryUnlessAnswered,
    // Keeps the previous page on screen while the next one loads, so paging
    // does not blank the table and jump the scroll position.
    placeholderData: (previous) => previous,
  });
}

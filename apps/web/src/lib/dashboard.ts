import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./api.js";
import type { CaseStatus } from "./cases.js";
import type { HearingType } from "./hearings.js";

export interface DashboardActivity {
  id: string;
  occurredAt: string;
  text: string;
  action: string;
  actor: { name: string; disabled: boolean } | null;
  link: { type: "case"; id: string } | { type: "client"; id: string } | null;
}

/**
 * A section that is *absent* means the reader may not see it; one that is
 * present and empty means there is nothing in it. The two render differently
 * — one is silent, the other says so — and the shape keeps them apart.
 */
export interface DashboardResponse {
  cases?: { byStatus: Record<CaseStatus, number>; total: number };
  myTasks?: {
    open: number;
    overdue: number;
    dueSoon: number;
    dueSoonDays: number;
  };
  upcoming?: {
    windowDays: number;
    items: Array<{
      caseId: string;
      caseNumber: string;
      caseTitleAr: string;
      dueAt: string;
      taskTitleAr: string;
      taskAssignedToName: string | null;
    }>;
  };
  hearings?: {
    windowDays: number;
    items: Array<{
      id: string;
      caseId: string;
      caseNumber: string;
      caseTitleAr: string;
      scheduledAt: string;
      hearingType: HearingType;
      court: string | null;
      circuit: string | null;
      assignedLawyerName: string | null;
    }>;
  };
  activity?: { items: DashboardActivity[] };
}

export function useDashboard(): UseQueryResult<DashboardResponse> {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<DashboardResponse>("/api/dashboard"),
    retry: (failureCount, error) => {
      const status = (error as { status?: number }).status;
      return status === 401 || status === 403 ? false : failureCount < 2;
    },
    // A landing page people return to all day; refetching on every focus would
    // be a request per tab switch for numbers that change a few times an hour.
    staleTime: 60_000,
  });
}

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./api.js";
import type { CaseStatus } from "./cases.js";
import type { ClientType } from "./clients.js";
import type { TaskPriority, TaskStatus } from "./tasks.js";

export const SEARCH_MIN_LENGTH = 2;

export interface ClientHit {
  id: string;
  clientType: ClientType;
  nameAr: string;
  name: string | null;
  identifier: string | null;
  archivedAt: string | null;
  rank: number;
}

export interface CaseHit {
  id: string;
  caseNumber: string;
  titleAr: string;
  title: string | null;
  status: CaseStatus;
  clientNameAr: string;
  archivedAt: string | null;
  rank: number;
}

export interface TaskHit {
  id: string;
  caseId: string;
  caseNumber: string;
  titleAr: string;
  title: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  rank: number;
}

export interface SearchGroup<T> {
  items: T[];
  total: number;
}

/**
 * A group that is *absent* means the caller may not see it; one that is empty
 * means nothing matched. The two must render differently — one is silent, the
 * other says "no results" — and the shape keeps them apart.
 */
export interface SearchResponse {
  clients?: SearchGroup<ClientHit>;
  cases?: SearchGroup<CaseHit>;
  tasks?: SearchGroup<TaskHit>;
}

export function useGlobalSearch(term: string): UseQueryResult<SearchResponse> {
  const trimmed = term.trim();

  return useQuery({
    queryKey: ["search", trimmed],
    queryFn: () =>
      apiFetch<SearchResponse>(
        `/api/search?q=${encodeURIComponent(trimmed)}`,
      ),
    enabled: trimmed.length >= SEARCH_MIN_LENGTH,
    retry: (failureCount, error) => {
      const status = (error as { status?: number }).status;
      return status === 401 || status === 403 ? false : failureCount < 2;
    },
    staleTime: 30_000,
    // Keeps the previous results visible while the next term loads, so the list
    // does not blank on every keystroke that survives the debounce.
    placeholderData: (previous) => previous,
  });
}

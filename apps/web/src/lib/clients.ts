import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./api.js";

export interface ClientOption {
  id: string;
  nameAr: string;
  clientType: "individual" | "company";
  archivedAt: string | null;
}

interface ClientsPage {
  clients: ClientOption[];
  total: number;
}

/**
 * The firm's clients, for choosing one when opening a case.
 *
 * Needs `clients.view`, which `cases.create` does not imply — a firm can
 * legitimately grant one without the other, and the caller then gets a 403 here
 * while the rest of the form works. The form says so rather than showing an
 * empty select, because an empty select is indistinguishable from a firm with
 * no clients yet.
 *
 * Archived clients are filtered out. Opening a new matter for a client the firm
 * has stopped acting for is almost always a mistake, and the ones that are not
 * can be un-archived first — a decision worth making deliberately rather than
 * by picking a name out of a list.
 *
 * One page of 100. That is a real ceiling and this select is the wrong control
 * for a firm past it; a search-backed picker is the answer, and it waits on the
 * Arabic search work.
 */
export function useClientOptions(
  enabled: boolean,
): UseQueryResult<ClientOption[]> {
  return useQuery({
    queryKey: ["clients", "options"],
    queryFn: async () => {
      const body = await apiFetch<ClientsPage>(
        "/api/clients?archived=false&limit=100",
      );
      return body.clients;
    },
    enabled,
    retry: (failureCount, error) => {
      const status = (error as { status?: number }).status;
      return status === 401 || status === 403 ? false : failureCount < 2;
    },
  });
}

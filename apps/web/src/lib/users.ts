import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./api.js";

export interface DirectoryUser {
  id: string;
  fullName: string;
  fullNameAr: string | null;
  email: string;
  disabledAt: string | null;
}

/**
 * Arabic where recorded, Latin otherwise — the same fallback the header uses.
 * `users.full_name_ar` is nullable, so a blank here would be a real, named
 * colleague with no label rather than an absence worth showing.
 */
export function userDisplayName(user: DirectoryUser): string {
  return user.fullNameAr ?? user.fullName;
}

/**
 * The firm's colleagues, for choosing who carries a matter.
 *
 * `includeDisabled` is false by default at the API too, so this asks for
 * exactly what a picker should offer: people who can still do the work. A
 * colleague who has left is filtered out in SQL rather than here, which means
 * this list cannot accidentally contain one.
 *
 * Needs `users.view`. Someone may hold `cases.assign` without it — a firm can
 * grant either alone — so a 403 is an expected answer here rather than a fault,
 * and the control that calls this handles it as one.
 */
export function useDirectory(
  enabled: boolean,
  includeDisabled = false,
): UseQueryResult<DirectoryUser[]> {
  return useQuery({
    queryKey: ["users", "directory", includeDisabled],
    queryFn: async () => {
      const body = await apiFetch<{ users: DirectoryUser[] }>(
        includeDisabled ? "/api/users?includeDisabled=true" : "/api/users",
      );
      return body.users;
    },
    enabled,
    retry: (failureCount, error) => {
      const status = (error as { status?: number }).status;
      return status === 401 || status === 403 ? false : failureCount < 2;
    },
    staleTime: 60_000,
  });
}

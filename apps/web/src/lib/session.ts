import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ApiError, apiFetch } from "./api.js";

export interface SessionUser {
  userId: string;
  email: string;
  fullName: string;
}

/**
 * Who is signed in, according to the server.
 *
 * There is no client-side session state, and that is deliberate. The prototype
 * in `artifacts/` kept a user object in localStorage and treated its presence as
 * proof of being signed in, which is not authentication — it is a flag the
 * person being authenticated can set themselves. Here the only source of truth
 * is `/auth/me`: the cookie is HttpOnly and unreadable from JavaScript, so
 * asking the server is not merely the better option, it is the only one.
 *
 * A 401 resolves to `null` rather than throwing. "Nobody is signed in" is an
 * ordinary answer to this question, not a failure, and treating it as an error
 * would put it in the same bucket as a server being down — which needs a very
 * different response from the interface.
 */
export function useSession(): UseQueryResult<SessionUser | null> {
  return useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        const body = await apiFetch<{ user: SessionUser }>("/api/auth/me");
        return body.user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return null;
        }

        throw error;
      }
    },
    // Retrying an unauthenticated request just delays the redirect to sign-in.
    retry: false,
    staleTime: 30_000,
  });
}

export const SESSION_QUERY_KEY = ["session"] as const;

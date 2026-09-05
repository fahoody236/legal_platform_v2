import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ApiError, apiFetch } from "./api.js";

export interface SessionUser {
  userId: string;
  email: string;
  fullName: string;
  fullNameAr: string | null;
}

export interface Session {
  user: SessionUser;
  /**
   * The caller's effective permissions, as `resource.action` keys.
   *
   * Used to decide what to offer, never to decide what is allowed. The API
   * refuses on its own and would refuse identically if this list were edited in
   * the browser — which someone can trivially do. Treating it as a control
   * would be building an access check out of a value the person being checked
   * supplies.
   */
  permissions: string[];
}

/**
 * Arabic where it exists, Latin otherwise. `users.full_name_ar` is nullable —
 * the Arabic-first rule migration 0011 applied to clients and cases was never
 * applied to users — so a blank here would be a real, named person with no
 * label rather than an absence worth showing.
 */
export function displayName(user: SessionUser): string {
  return user.fullNameAr ?? user.fullName;
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
export function useSession(): UseQueryResult<Session | null> {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      try {
        return await apiFetch<Session>("/api/auth/me");
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

/**
 * Whether the signed-in person holds a permission.
 *
 * Defaults to `false` while the session is loading, so a control appears once
 * it is known to be usable rather than flickering into view and then vanishing.
 * Erring towards hiding also means a slow session query never shows a button
 * that would fail.
 */
export function useHasPermission(permission: string): boolean {
  const session = useSession();
  return session.data?.permissions.includes(permission) ?? false;
}

export const SESSION_QUERY_KEY = ["session"] as const;

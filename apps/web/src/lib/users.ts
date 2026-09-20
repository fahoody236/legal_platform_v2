import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
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

/* ── Management (users.manage) ───────────────────────────────────────────── */

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export interface Invitation {
  userId: string;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
}

/**
 * What the server hands back when a link is issued. `link` is shown once and
 * never retrievable — only its hash is stored — so the screen has to show it
 * now or not at all. `emailSent` is false until a mail transport exists.
 */
export interface IssuedInvitation {
  link: string;
  expiresAt: string;
  emailSent: boolean;
}

/** The latest invitation per user who has one. Needs `users.manage`. */
export function useInvitations(enabled: boolean): UseQueryResult<Invitation[]> {
  return useQuery({
    queryKey: ["users", "invitations"],
    queryFn: async () =>
      (await apiFetch<{ invitations: Invitation[] }>("/api/users/invitations"))
        .invitations,
    enabled,
    retry: (failureCount, error) => {
      const status = (error as { status?: number }).status;
      return status === 401 || status === 403 ? false : failureCount < 2;
    },
  });
}

/**
 * Every user mutation invalidates the directory and the role assignments —
 * a new colleague appears in both — and the session, so an administrator who
 * disables themselves sees the interface change now.
 */
function useUserMutation<TBody, TResult>(
  request: (body: TBody) => Promise<TResult>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["roles"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });
}

export interface NewUserBody {
  email: string;
  fullNameAr: string;
  fullName: string;
}

export function useCreateUser() {
  return useUserMutation((body: NewUserBody) =>
    apiFetch<{ user: DirectoryUser; invitation: IssuedInvitation }>(
      "/api/users",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
  );
}

export function useUpdateUser(userId: string) {
  return useUserMutation((body: { fullNameAr: string; fullName: string }) =>
    apiFetch<{ user: DirectoryUser }>(
      `/api/users/${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    ).then((r) => r.user),
  );
}

export function useDisableUser(userId: string) {
  return useUserMutation(() =>
    apiFetch<{ user: DirectoryUser }>(
      `/api/users/${encodeURIComponent(userId)}/disable`,
      { method: "POST" },
    ).then((r) => r.user),
  );
}

export function useEnableUser(userId: string) {
  return useUserMutation(() =>
    apiFetch<{ user: DirectoryUser }>(
      `/api/users/${encodeURIComponent(userId)}/enable`,
      { method: "POST" },
    ).then((r) => r.user),
  );
}

export function useResendInvitation(userId: string) {
  return useUserMutation(() =>
    apiFetch<{ invitation: IssuedInvitation }>(
      `/api/users/${encodeURIComponent(userId)}/invitations`,
      { method: "POST" },
    ).then((r) => r.invitation),
  );
}

/* ── Accepting an invitation (no session) ────────────────────────────────── */

export interface InvitationPreview {
  email: string;
  fullName: string;
  fullNameAr: string | null;
  expiresAt: string;
}

/** 404 for a dead link of any kind; the screen says so in one sentence. */
export function useInvitationPreview(
  token: string,
): UseQueryResult<InvitationPreview> {
  return useQuery({
    queryKey: ["invitation", token],
    queryFn: async () =>
      (
        await apiFetch<{ invitation: InvitationPreview }>(
          "/api/invitations/lookup",
          {
            method: "POST",
            body: JSON.stringify({ token }),
          },
        )
      ).invitation,
    retry: false,
    staleTime: Infinity,
  });
}

export function useAcceptInvitation(token: string) {
  return useMutation({
    mutationFn: (password: string) =>
      apiFetch<void>("/api/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      }),
  });
}

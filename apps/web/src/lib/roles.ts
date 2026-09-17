import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiFetch } from "./api.js";

export interface Permission {
  key: string;
  resource: string;
  action: string;
  description: string;
  labelAr: string;
}

export interface PermissionGroup {
  resource: string;
  labelAr: string;
  sortOrder: number;
  permissions: Permission[];
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  permissionKeys: string[];
  userCount: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface RoleAssignment {
  userId: string;
  roleId: string;
}

export const ADMIN_PERMISSION = "roles.manage";

function retryUnlessAnswered(failureCount: number, error: Error): boolean {
  const status = (error as { status?: number }).status;
  return status === 401 || status === 403 || status === 404
    ? false
    : failureCount < 2;
}

export function usePermissionGroups(
  enabled: boolean,
): UseQueryResult<PermissionGroup[]> {
  return useQuery({
    queryKey: ["permissions"],
    queryFn: async () =>
      (await apiFetch<{ groups: PermissionGroup[] }>("/api/permissions")).groups,
    enabled,
    retry: retryUnlessAnswered,
    // The catalogue changes by migration. Once per session is plenty.
    staleTime: Infinity,
  });
}

export function useRoles(enabled: boolean): UseQueryResult<Role[]> {
  return useQuery({
    queryKey: ["roles", "list"],
    queryFn: async () => (await apiFetch<{ roles: Role[] }>("/api/roles")).roles,
    enabled,
    retry: retryUnlessAnswered,
  });
}

export function useRoleAssignments(
  enabled: boolean,
): UseQueryResult<RoleAssignment[]> {
  return useQuery({
    queryKey: ["roles", "assignments"],
    queryFn: async () =>
      (await apiFetch<{ assignments: RoleAssignment[] }>("/api/roles/assignments"))
        .assignments,
    enabled,
    retry: retryUnlessAnswered,
  });
}

/**
 * Every role mutation invalidates roles, assignments, and the session.
 *
 * The session, because permissions are read per request on the server but
 * cached for thirty seconds here — and an administrator who has just removed
 * a permission from their own role should see the interface change now, not
 * when the cache expires. The API would refuse the stale button anyway; this
 * is about not showing it.
 */
function useRoleMutation<TBody, TResult>(
  request: (body: TBody) => Promise<TResult>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["roles"] });
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });
}

export interface RoleBody {
  name: string;
  description?: string | null;
  permissionKeys: string[];
}

export function useCreateRole() {
  return useRoleMutation((body: RoleBody) =>
    apiFetch<{ role: Role }>("/api/roles", {
      method: "POST",
      body: JSON.stringify(body),
    }).then((r) => r.role),
  );
}

export function useUpdateRole(roleId: string) {
  return useRoleMutation((body: Partial<RoleBody>) =>
    apiFetch<{ role: Role }>(`/api/roles/${encodeURIComponent(roleId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then((r) => r.role),
  );
}

export function useArchiveRole(roleId: string) {
  return useRoleMutation(() =>
    apiFetch<{ role: Role }>(`/api/roles/${encodeURIComponent(roleId)}/archive`, {
      method: "POST",
    }).then((r) => r.role),
  );
}

export function useSetUserRoles(userId: string) {
  return useRoleMutation((roleIds: string[]) =>
    apiFetch<{ removed: string[]; added: string[] }>(
      `/api/users/${encodeURIComponent(userId)}/roles`,
      { method: "PATCH", body: JSON.stringify({ roleIds }) },
    ),
  );
}

/**
 * The roles that make someone an administrator: active, and carrying
 * `roles.manage`. Used by both settings screens to work out, before any
 * request, whether an edit would leave the firm without one — so the control
 * can be disabled with a reason rather than refused after the fact.
 */
export function administratorRoleIds(roles: Role[]): Set<string> {
  return new Set(
    roles
      .filter((r) => r.archivedAt === null && r.permissionKeys.includes(ADMIN_PERMISSION))
      .map((r) => r.id),
  );
}

/** Active users holding any administrator role, from the assignment pairs. */
export function administratorUserIds(
  roles: Role[],
  assignments: RoleAssignment[],
  activeUserIds: Set<string>,
): Set<string> {
  const adminRoles = administratorRoleIds(roles);
  return new Set(
    assignments
      .filter((a) => adminRoles.has(a.roleId) && activeUserIds.has(a.userId))
      .map((a) => a.userId),
  );
}

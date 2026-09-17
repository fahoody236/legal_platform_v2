import { useState } from "react";
import { ApiError, isApiError } from "../lib/api.js";
import {
  administratorRoleIds,
  administratorUserIds,
  useRoleAssignments,
  useRoles,
  useSetUserRoles,
  type Role,
  type RoleAssignment,
} from "../lib/roles.js";
import { useHasPermission, useSession } from "../lib/session.js";
import { useDirectory, userDisplayName, type DirectoryUser } from "../lib/users.js";
import { AppHeader } from "./app-header.js";
import { SettingsNav } from "./settings-nav.js";

const LAST_ADMIN =
  "لا يمكن تنفيذ هذا التغيير: سيبقى المكتب بلا أي مستخدم يحمل صلاحية «إدارة الأدوار والصلاحيات». امنح الصلاحية لشخص آخر أولاً.";

function messageFor(error: unknown): string | null {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.code === "last_administrator") return LAST_ADMIN;
    if (error.status === 403) return "لا تملك صلاحية إدارة الأدوار.";
    if (error.status === 404) return "لم يعد هذا المستخدم متاحاً.";
    return "تعذّر الحفظ. حاول مرة أخرى.";
  }
  if (error) return "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى.";
  return null;
}

/**
 * Who works here and what they may do.
 *
 * Needs `roles.view` for the roles and `users.view` for the directory. The
 * second is the one an administrator might lack: a firm can grant someone the
 * roles screen without the directory, in which case this page can say so but
 * not much else.
 */
export function SettingsUsersPage() {
  const canView = useHasPermission("roles.view");
  const canManage = useHasPermission("roles.manage");
  const session = useSession();
  const roles = useRoles(canView);
  const assignments = useRoleAssignments(canView);
  // Disabled colleagues included and marked: their roles are still on record,
  // and an administrator deciding who holds what should see the whole firm.
  const directory = useDirectory(canView, true);

  const error = roles.error ?? assignments.error ?? directory.error;

  return (
    <main className="wide">
      <AppHeader title="المستخدمون" />
      <SettingsNav />

      {!canView && session.isSuccess && (
        <p className="state denied" role="alert">
          لا تملك صلاحية عرض الأدوار والصلاحيات. راجع مدير المكتب.
        </p>
      )}

      {canView && (roles.isPending || assignments.isPending || directory.isPending) && (
        <p className="state" role="status" aria-live="polite">
          جارٍ التحميل…
        </p>
      )}

      {error && (
        <p className="state error" role="alert">
          {isApiError(directory.error, 403)
            ? "لا تملك صلاحية عرض المستخدمين، وهي لازمة لهذه الشاشة."
            : isApiError(error, 403)
              ? "لا تملك صلاحية عرض الأدوار والصلاحيات."
              : "تعذّر تحميل المستخدمين. حاول مرة أخرى."}
        </p>
      )}

      {roles.isSuccess && assignments.isSuccess && directory.isSuccess && (
        <UsersBody
          users={directory.data}
          roles={roles.data}
          assignments={assignments.data}
          canManage={canManage}
          myUserId={session.data?.user.userId ?? null}
        />
      )}
    </main>
  );
}

function UsersBody({
  users,
  roles,
  assignments,
  canManage,
  myUserId,
}: {
  users: DirectoryUser[];
  roles: Role[];
  assignments: RoleAssignment[];
  canManage: boolean;
  myUserId: string | null;
}) {
  const activeIds = new Set(users.filter((u) => u.disabledAt === null).map((u) => u.id));
  const adminRoles = administratorRoleIds(roles);
  const admins = administratorUserIds(roles, assignments, activeIds);
  const activeRoles = roles.filter((r) => r.archivedAt === null);

  const rolesOf = (userId: string) =>
    new Set(assignments.filter((a) => a.userId === userId).map((a) => a.roleId));

  return (
    <ul className="plain-list user-list">
      {users.map((user) => (
        <UserRow
          key={user.id}
          user={user}
          roles={activeRoles}
          adminRoles={adminRoles}
          held={rolesOf(user.id)}
          canManage={canManage}
          isSelf={user.id === myUserId}
          // The one person whose administrator roles cannot be removed: they
          // are the only active administrator the firm has.
          isSoleAdministrator={admins.size === 1 && admins.has(user.id)}
        />
      ))}
    </ul>
  );
}

function UserRow({
  user,
  roles,
  adminRoles,
  held,
  canManage,
  isSelf,
  isSoleAdministrator,
}: {
  user: DirectoryUser;
  roles: Role[];
  adminRoles: Set<string>;
  held: Set<string>;
  canManage: boolean;
  isSelf: boolean;
  isSoleAdministrator: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(held);
  const set = useSetUserRoles(user.id);

  const heldNames = roles.filter((r) => held.has(r.id)).map((r) => r.name);
  const disabled = user.disabledAt !== null;

  function toggle(roleId: string) {
    setDraft((current) => {
      const next = new Set(current);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }

  const hadAdmin = [...held].some((id) => adminRoles.has(id));
  const willHaveAdmin = [...draft].some((id) => adminRoles.has(id));
  const removingOwnAdmin = isSelf && hadAdmin && !willHaveAdmin;

  function save() {
    if (
      removingOwnAdmin &&
      !window.confirm(
        "أنت على وشك نزع صلاحية «إدارة الأدوار والصلاحيات» من نفسك. لن تتمكن بعدها من العودة إلى هذه الشاشة إلا إذا أعادها لك مدير آخر. المتابعة؟",
      )
    ) {
      return;
    }

    set.mutate([...draft], {
      onSuccess: () => {
        setEditing(false);
        set.reset();
      },
    });
  }

  return (
    <li className={disabled ? "user-row muted" : "user-row"}>
      <div className="role-main">
        <div className="role-title">
          <strong>{userDisplayName(user)}</strong>
          <span className="muted" dir="ltr">
            {user.email}
          </span>
          {isSelf && (
            <span className="badge" style={{ color: "#1f3d8f", background: "#e9eefb" }}>
              أنت
            </span>
          )}
          {disabled && (
            <span className="badge" style={{ color: "#4a4a45", background: "#eeeeec" }}>
              معطّل
            </span>
          )}
        </div>

        {!editing && (
          <p className="role-permissions muted">
            {heldNames.length === 0 ? "بلا أدوار" : heldNames.join(" · ")}
          </p>
        )}

        {editing && (
          <div className="role-checklist">
            {roles.map((role) => {
              // An administrator role held by the only administrator: unticking
              // would be refused at commit, so it is locked with the reason.
              const locked = isSoleAdministrator && adminRoles.has(role.id) && held.has(role.id);

              return (
                <label key={role.id} className="toggle permission-toggle">
                  <input
                    type="checkbox"
                    checked={draft.has(role.id)}
                    disabled={locked || set.isPending}
                    onChange={() => toggle(role.id)}
                  />
                  {role.name}
                  {adminRoles.has(role.id) && <span className="muted"> (إداري)</span>}
                  {locked && <span className="hint"> — {LAST_ADMIN}</span>}
                </label>
              );
            })}

            {removingOwnAdmin && (
              <p className="state denied" role="status">
                تنبيه: هذا التغيير ينزع صلاحية الإدارة من نفسك. سيُطلب تأكيدك عند الحفظ.
              </p>
            )}

            {set.error && (
              <p className="field-error" role="alert">
                {messageFor(set.error)}
              </p>
            )}

            <div className="form-actions">
              <button type="button" disabled={set.isPending} onClick={save}>
                {set.isPending ? "جارٍ الحفظ…" : "حفظ"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={set.isPending}
                onClick={() => {
                  setEditing(false);
                  setDraft(held);
                  set.reset();
                }}
              >
                إلغاء
              </button>
            </div>
          </div>
        )}
      </div>

      {canManage && !editing && !disabled && (
        <div className="task-actions">
          <button
            type="button"
            className="link"
            onClick={() => {
              setDraft(held);
              setEditing(true);
            }}
          >
            تغيير الأدوار
          </button>
        </div>
      )}
    </li>
  );
}

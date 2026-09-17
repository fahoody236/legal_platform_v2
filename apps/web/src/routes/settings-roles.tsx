import { useState, type FormEvent } from "react";
import { ApiError, isApiError } from "../lib/api.js";
import {
  ADMIN_PERMISSION,
  administratorRoleIds,
  useArchiveRole,
  useCreateRole,
  usePermissionGroups,
  useRoleAssignments,
  useRoles,
  useUpdateRole,
  type PermissionGroup,
  type Role,
} from "../lib/roles.js";
import { useHasPermission, useSession } from "../lib/session.js";
import { AppHeader } from "./app-header.js";
import { SettingsNav } from "./settings-nav.js";

/**
 * The one message the interface has to get right on this screen.
 *
 * The rule is a database trigger, so the refusal arrives after the request as
 * a 409 carrying `code: "last_administrator"`. Where the screen can see it
 * coming — the only administrator role, the only administrator — the control
 * is disabled with this same reason, so most people never hit the refusal at
 * all. The two paths say the same thing on purpose.
 */
const LAST_ADMIN =
  "لا يمكن تنفيذ هذا التغيير: سيبقى المكتب بلا أي مستخدم يحمل صلاحية «إدارة الأدوار والصلاحيات». امنح الصلاحية لشخص آخر أولاً.";

function messageFor(error: unknown): string | null {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.code === "last_administrator") return LAST_ADMIN;
    if (error.status === 409) return "يوجد دور بهذا الاسم بالفعل.";
    if (error.status === 403) return "لا تملك صلاحية إدارة الأدوار.";
    if (error.status === 404) return "لم يعد هذا الدور متاحاً.";
    if (error.status === 400) return "راجع الحقول ثم حاول مرة أخرى.";
    return "تعذّر الحفظ. حاول مرة أخرى.";
  }
  if (error) return "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى.";
  return null;
}

export function SettingsRolesPage() {
  const canView = useHasPermission("roles.view");
  const canManage = useHasPermission("roles.manage");
  const roles = useRoles(canView);
  const groups = usePermissionGroups(canView);
  const assignments = useRoleAssignments(canView);
  const session = useSession();
  const [creating, setCreating] = useState(false);

  return (
    <main className="wide">
      <AppHeader
        title="الأدوار والصلاحيات"
        actions={
          canManage && !creating ? (
            <button type="button" onClick={() => setCreating(true)}>
              دور جديد
            </button>
          ) : undefined
        }
      />

      <SettingsNav />

      {!canView && session.isSuccess && (
        <p className="state denied" role="alert">
          لا تملك صلاحية عرض الأدوار والصلاحيات. راجع مدير المكتب.
        </p>
      )}

      {canView && (roles.isPending || groups.isPending || assignments.isPending) && (
        <p className="state" role="status" aria-live="polite">
          جارٍ التحميل…
        </p>
      )}

      {(roles.error || groups.error || assignments.error) && (
        <p className="state error" role="alert">
          {isApiError(roles.error ?? groups.error ?? assignments.error, 403)
            ? "لا تملك صلاحية عرض الأدوار والصلاحيات."
            : "تعذّر تحميل الأدوار. حاول مرة أخرى."}
        </p>
      )}

      {roles.isSuccess && groups.isSuccess && assignments.isSuccess && (
        <RolesBody
          roles={roles.data}
          groups={groups.data}
          myRoleIds={
            new Set(
              assignments.data
                .filter((a) => a.userId === session.data?.user.userId)
                .map((a) => a.roleId),
            )
          }
          canManage={canManage}
          creating={creating}
          onCreated={() => setCreating(false)}
        />
      )}
    </main>
  );
}

function RolesBody({
  roles,
  groups,
  myRoleIds,
  canManage,
  creating,
  onCreated,
}: {
  roles: Role[];
  groups: PermissionGroup[];
  myRoleIds: Set<string>;
  canManage: boolean;
  creating: boolean;
  onCreated: () => void;
}) {
  const adminRoles = administratorRoleIds(roles);
  // Administrator roles that someone actually holds. If there is exactly one,
  // taking roles.manage out of it — or archiving it — would be refused, and
  // the screen can say so before the request rather than after.
  const heldAdminRoles = roles.filter((r) => adminRoles.has(r.id) && r.userCount > 0);
  const soleAdminRoleId = heldAdminRoles.length === 1 ? heldAdminRoles[0]?.id : undefined;

  const active = roles.filter((r) => r.archivedAt === null);
  const archived = roles.filter((r) => r.archivedAt !== null);

  return (
    <>
      {creating && (
        <RoleEditor
          mode="create"
          groups={groups}
          isSoleAdminRole={false}
          iHoldThisRole={false}
          iHoldAnotherAdminRole={[...myRoleIds].some((id) => adminRoles.has(id))}
          onDone={onCreated}
        />
      )}

      {active.length === 0 && !creating && (
        <p className="state empty">لا توجد أدوار بعد.</p>
      )}

      <ul className="plain-list role-list">
        {active.map((role) => (
          <RoleRow
            key={role.id}
            role={role}
            groups={groups}
            canManage={canManage}
            isSoleAdminRole={role.id === soleAdminRoleId}
            iHoldThisRole={myRoleIds.has(role.id)}
            iHoldAnotherAdminRole={[...myRoleIds].some(
              (id) => id !== role.id && adminRoles.has(id),
            )}
          />
        ))}
      </ul>

      {archived.length > 0 && (
        <details className="archived-roles">
          <summary>الأدوار المؤرشفة ({archived.length})</summary>
          <ul className="plain-list role-list">
            {archived.map((role) => (
              <li key={role.id} className="muted">
                <strong>{role.name}</strong>
                {role.description && ` — ${role.description}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function RoleRow({
  role,
  groups,
  canManage,
  isSoleAdminRole,
  iHoldThisRole,
  iHoldAnotherAdminRole,
}: {
  role: Role;
  groups: PermissionGroup[];
  canManage: boolean;
  isSoleAdminRole: boolean;
  iHoldThisRole: boolean;
  iHoldAnotherAdminRole: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const archive = useArchiveRole(role.id);

  const labelFor = (key: string) =>
    groups.flatMap((g) => g.permissions).find((p) => p.key === key)?.labelAr ?? key;

  if (editing) {
    return (
      <li className="role-form-row">
        <RoleEditor
          mode="edit"
          role={role}
          groups={groups}
          isSoleAdminRole={isSoleAdminRole}
          iHoldThisRole={iHoldThisRole}
          iHoldAnotherAdminRole={iHoldAnotherAdminRole}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="role-row">
      <div className="role-main">
        <div className="role-title">
          <strong>{role.name}</strong>
          <span className="muted">
            {" · "}
            {role.userCount === 0
              ? "لا يحمله أحد"
              : role.userCount === 1
                ? "يحمله مستخدم واحد"
                : `يحمله ${role.userCount} مستخدمين`}
          </span>
          {role.permissionKeys.includes(ADMIN_PERMISSION) && (
            <span className="badge" style={{ color: "#8a5a06", background: "#fdf3e3" }}>
              إداري
            </span>
          )}
        </div>
        {role.description && <p className="task-description">{role.description}</p>}
        <p className="role-permissions muted">
          {role.permissionKeys.length === 0
            ? "بلا صلاحيات"
            : role.permissionKeys.map(labelFor).join(" · ")}
        </p>
      </div>

      {canManage && (
        <div className="task-actions">
          <button type="button" className="link" onClick={() => setEditing(true)}>
            تعديل
          </button>
          {/*
            Archiving the only role that makes anyone an administrator is
            refused by the database. Disabled here with the same reason, so the
            person sees why rather than a button that fails.
          */}
          <button
            type="button"
            className="link"
            disabled={archive.isPending || isSoleAdminRole}
            title={isSoleAdminRole ? LAST_ADMIN : undefined}
            onClick={() => {
              if (window.confirm(`أرشفة الدور «${role.name}»؟ سيفقد من يحمله صلاحياته منه.`)) {
                archive.mutate(undefined);
              }
            }}
          >
            {archive.isPending ? "جارٍ الأرشفة…" : "أرشفة"}
          </button>
        </div>
      )}

      {isSoleAdminRole && canManage && (
        <p className="hint role-hint">
          هذا هو الدور الإداري الوحيد الذي يحمله أحد؛ لا يمكن أرشفته أو نزع
          صلاحية الإدارة منه حتى يُمنح دور إداري آخر لشخص ما.
        </p>
      )}

      {archive.error && (
        <p className="field-error" role="alert">
          {messageFor(archive.error)}
        </p>
      )}
    </li>
  );
}

/**
 * Creating or editing a role: name, description, and the permission set as
 * checkboxes grouped by resource.
 *
 * Two guards on the `roles.manage` checkbox, for two different situations:
 *
 *   * **The sole administrator role.** Unticking would be refused at commit, so
 *     the box is disabled with the reason. Nothing the person can do on this
 *     form makes it allowed; they need to grant another administrator first.
 *   * **A role I hold, and my only route to administration.** Unticking is
 *     allowed — someone else is an administrator — but it removes my own
 *     ability to come back to this screen. Allowed, and confirmed, because the
 *     mistake is easy and the recovery needs a colleague.
 */
function RoleEditor({
  mode,
  role,
  groups,
  isSoleAdminRole,
  iHoldThisRole,
  iHoldAnotherAdminRole,
  onDone,
}: {
  mode: "create" | "edit";
  role?: Role;
  groups: PermissionGroup[];
  isSoleAdminRole: boolean;
  iHoldThisRole: boolean;
  iHoldAnotherAdminRole: boolean;
  onDone: () => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [keys, setKeys] = useState<Set<string>>(new Set(role?.permissionKeys ?? []));
  const [nameError, setNameError] = useState<string | null>(null);

  const create = useCreateRole();
  const update = useUpdateRole(role?.id ?? "");
  const mutation = mode === "create" ? create : update;

  const adminLocked = mode === "edit" && isSoleAdminRole;
  const removingOwnAdmin =
    mode === "edit" &&
    iHoldThisRole &&
    !iHoldAnotherAdminRole &&
    role?.permissionKeys.includes(ADMIN_PERMISSION) === true &&
    !keys.has(ADMIN_PERMISSION);

  function toggle(key: string) {
    setKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!name.trim()) {
      setNameError("هذا الحقل مطلوب.");
      return;
    }

    if (
      removingOwnAdmin &&
      !window.confirm(
        "أنت على وشك نزع صلاحية «إدارة الأدوار والصلاحيات» من نفسك. لن تتمكن بعدها من العودة إلى هذه الشاشة إلا إذا أعادها لك مدير آخر. المتابعة؟",
      )
    ) {
      return;
    }

    const body = {
      name: name.trim(),
      description: description.trim() || null,
      permissionKeys: [...keys].sort(),
    };

    if (mode === "create") create.mutate(body, { onSuccess: onDone });
    else update.mutate(body, { onSuccess: onDone });
  }

  const message = messageFor(mutation.error);

  return (
    <form className="task-form role-editor" onSubmit={handleSubmit} noValidate>
      <h3>{mode === "create" ? "دور جديد" : `تعديل الدور «${role?.name}»`}</h3>

      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}

      <div className="field">
        <label htmlFor="role-name">اسم الدور</label>
        <input
          id="role-name"
          value={name}
          aria-describedby={nameError ? "role-name-error" : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
        />
        {nameError && (
          <p className="field-error" id="role-name-error" role="alert">
            {nameError}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="role-description">الوصف — اختياري</label>
        <input
          id="role-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <fieldset className="permission-groups">
        <legend>الصلاحيات</legend>

        {groups.map((group) => (
          <div key={group.resource} className="permission-group">
            <h4>{group.labelAr}</h4>
            {group.permissions.map((permission) => {
              const locked = adminLocked && permission.key === ADMIN_PERMISSION;

              return (
                <label key={permission.key} className="toggle permission-toggle">
                  <input
                    type="checkbox"
                    checked={keys.has(permission.key)}
                    disabled={locked}
                    onChange={() => toggle(permission.key)}
                  />
                  {permission.labelAr}
                  {locked && (
                    <span className="hint"> — {LAST_ADMIN}</span>
                  )}
                </label>
              );
            })}
          </div>
        ))}
      </fieldset>

      {removingOwnAdmin && (
        <p className="state denied" role="status">
          تنبيه: هذا التغيير ينزع صلاحية الإدارة من نفسك. سيُطلب تأكيدك عند الحفظ.
        </p>
      )}

      <div className="form-actions">
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "جارٍ الحفظ…" : mode === "create" ? "إنشاء" : "حفظ"}
        </button>
        <button type="button" className="secondary" disabled={mutation.isPending} onClick={onDone}>
          إلغاء
        </button>
      </div>
    </form>
  );
}

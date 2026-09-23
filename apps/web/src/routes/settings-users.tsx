import { useId, useState, type FormEvent } from "react";
import { ApiError, isApiError } from "../lib/api.js";
import { formatDateTime } from "../lib/dates.js";
import {
  administratorRoleIds,
  administratorUserIds,
  useRoleAssignments,
  useRoles,
  useSetRolesOfUser,
  useSetUserRoles,
  type Role,
  type RoleAssignment,
} from "../lib/roles.js";
import { useHasPermission, useSession } from "../lib/session.js";
import {
  useCreateUser,
  useDirectory,
  useDisableUser,
  useEnableUser,
  useInvitations,
  useResendInvitation,
  useUpdateUser,
  userDisplayName,
  type DirectoryUser,
  type Invitation,
  type IssuedInvitation,
} from "../lib/users.js";
import { AppHeader } from "./app-header.js";
import { SettingsNav } from "./settings-nav.js";

const LAST_ADMIN =
  "لا يمكن تنفيذ هذا التغيير: سيبقى المكتب بلا أي مستخدم يحمل صلاحية «إدارة الأدوار والصلاحيات». امنح الصلاحية لشخص آخر أولاً.";

const NETWORK = "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى.";

function messageFor(error: unknown): string | null {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.code === "last_administrator")
      return LAST_ADMIN;
    if (error.status === 409 && error.code === "user_disabled")
      return "هذا المستخدم معطّل. فعّله أولاً ثم أعد إرسال الدعوة.";
    if (error.status === 409)
      return "يوجد مستخدم بهذا البريد الإلكتروني في المكتب بالفعل. إن كان حسابه معطّلاً فيمكنك تفعيله بدلاً من إنشاء حساب جديد.";
    if (error.status === 403) return "لا تملك الصلاحية اللازمة لهذا الإجراء.";
    if (error.status === 404) return "لم يعد هذا المستخدم متاحاً.";
    if (error.status === 400) return "تحقّق من الحقول ثم حاول مرة أخرى.";
    return "تعذّر الحفظ. حاول مرة أخرى.";
  }
  if (error) return NETWORK;
  return null;
}

/**
 * Who works here and what they may do.
 *
 * Open on either `roles.view` or `users.manage`, because two different jobs
 * meet on this screen and neither needs the other's permission. Someone who
 * administers permissions reads the roles each colleague holds; someone who
 * administers people adds them, edits their names, and disables them when
 * they leave. A firm can hire an office manager for the second without
 * handing them the first.
 *
 * So the roles are a section of this screen rather than its subject. Without
 * `roles.view` the role column and the role checklist are simply not there —
 * not greyed out, not empty — and the queries behind them are never made,
 * which matters because the API would refuse them and the screen would have
 * to explain an error nobody caused.
 *
 * `users.view` is the third permission in play and is the one an
 * administrator might lack without noticing: it gates the directory itself,
 * so without it this screen has nothing to list and says so.
 */
export function SettingsUsersPage() {
  const canSeeRoles = useHasPermission("roles.view");
  const canManageRoles = useHasPermission("roles.manage");
  const canManageUsers = useHasPermission("users.manage");
  const canOpen = canSeeRoles || canManageUsers;
  const session = useSession();
  const roles = useRoles(canSeeRoles);
  const assignments = useRoleAssignments(canSeeRoles);
  // Disabled colleagues included and marked: their roles are still on record,
  // and an administrator deciding who holds what should see the whole firm.
  const directory = useDirectory(canOpen, true);
  const invitations = useInvitations(canManageUsers);
  const [adding, setAdding] = useState(false);

  const error =
    roles.error ?? assignments.error ?? directory.error ?? invitations.error;

  // Each half waits only for the queries it actually made.
  const loading =
    directory.isPending ||
    (canSeeRoles && (roles.isPending || assignments.isPending)) ||
    (canManageUsers && invitations.isPending);

  const ready =
    directory.isSuccess &&
    (!canSeeRoles || (roles.isSuccess && assignments.isSuccess));

  return (
    <main className="wide">
      <AppHeader
        title="المستخدمون"
        // `ready` as well as the permission: the form renders inside the list,
        // so offering the button while the list has failed to load would be an
        // affordance that does nothing. That happens for `users.manage`
        // without `users.view`, where the message below is the useful answer.
        actions={
          canManageUsers &&
          ready && (
            <button
              type="button"
              disabled={adding}
              onClick={() => setAdding(true)}
            >
              مستخدم جديد
            </button>
          )
        }
      />
      <SettingsNav />

      {!canOpen && session.isSuccess && (
        <p className="state denied" role="alert">
          لا تملك صلاحية عرض هذه الشاشة. تحتاج إلى صلاحية «إدارة المستخدمين» أو
          «عرض الأدوار والصلاحيات». راجع مدير المكتب.
        </p>
      )}

      {canOpen && loading && (
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

      {ready && (
        <UsersBody
          users={directory.data}
          // null rather than an empty array: "I cannot see the roles" and "this
          // firm has none" are different facts, and only the first should
          // remove the column.
          roles={canSeeRoles ? (roles.data ?? null) : null}
          assignments={canSeeRoles ? (assignments.data ?? null) : null}
          invitations={invitations.data ?? []}
          canManageRoles={canManageRoles}
          canManageUsers={canManageUsers}
          myUserId={session.data?.user.userId ?? null}
          adding={adding}
          onDoneAdding={() => setAdding(false)}
        />
      )}
    </main>
  );
}

function UsersBody({
  users,
  roles,
  assignments,
  invitations,
  canManageRoles,
  canManageUsers,
  myUserId,
  adding,
  onDoneAdding,
}: {
  users: DirectoryUser[];
  /** Null when the reader lacks `roles.view`: no role column, no checklist. */
  roles: Role[] | null;
  assignments: RoleAssignment[] | null;
  invitations: Invitation[];
  canManageRoles: boolean;
  canManageUsers: boolean;
  myUserId: string | null;
  adding: boolean;
  onDoneAdding: () => void;
}) {
  const activeIds = new Set(
    users.filter((u) => u.disabledAt === null).map((u) => u.id),
  );
  const adminRoles = roles ? administratorRoleIds(roles) : new Set<string>();
  /**
   * Who the firm's administrators are — and so which row must not be disabled.
   *
   * Empty when the roles are invisible, which means the screen cannot lock
   * that row in advance. The rule still holds: it is a database trigger, the
   * commit is refused, and the row shows the same sentence the lock would
   * have. A reader without `roles.view` meets it a moment later than one with.
   */
  const admins =
    roles && assignments
      ? administratorUserIds(roles, assignments, activeIds)
      : new Set<string>();
  const activeRoles = roles?.filter((r) => r.archivedAt === null) ?? null;

  const rolesOf = (userId: string) =>
    new Set(
      (assignments ?? [])
        .filter((a) => a.userId === userId)
        .map((a) => a.roleId),
    );

  const invitationOf = (userId: string) =>
    invitations.find((i) => i.userId === userId) ?? null;

  return (
    <ul className="plain-list user-list">
      {adding && (
        <li className="role-form-row">
          <NewUserForm
            roles={activeRoles}
            adminRoles={adminRoles}
            canManageRoles={canManageRoles}
            onDone={onDoneAdding}
          />
        </li>
      )}

      {users.map((user) => (
        <UserRow
          key={user.id}
          user={user}
          roles={activeRoles}
          adminRoles={adminRoles}
          held={rolesOf(user.id)}
          invitation={invitationOf(user.id)}
          canManageRoles={canManageRoles}
          canManageUsers={canManageUsers}
          isSelf={user.id === myUserId}
          // The one person whose administrator roles cannot be removed, and
          // who cannot be disabled: the only active administrator the firm has.
          isSoleAdministrator={admins.size === 1 && admins.has(user.id)}
        />
      ))}
    </ul>
  );
}

/**
 * The link, shown once.
 *
 * The server keeps only a hash, so this is the one moment the link exists in
 * the clear on this side. Until a mail transport exists `emailSent` is always
 * false, and the wording says so plainly: the administrator is the delivery
 * mechanism.
 */
function InvitationIssued({
  invitation,
  onDismiss,
}: {
  invitation: IssuedInvitation;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const id = useId();

  async function copy() {
    try {
      await navigator.clipboard.writeText(invitation.link);
      setCopied(true);
    } catch {
      // No clipboard access — the field is selectable, which is the fallback.
      document.getElementById(id)?.focus();
      (document.getElementById(id) as HTMLInputElement | null)?.select();
    }
  }

  return (
    <div className="invitation-issued" role="status">
      <p>
        {invitation.emailSent
          ? "أُرسل رابط الدعوة إلى البريد الإلكتروني. يمكنك أيضاً نسخه من هنا:"
          : "لم يُرسل بريد إلكتروني — إرسال البريد غير مفعّل بعد. انسخ رابط الدعوة وأرسله إلى الشخص بنفسك:"}
      </p>
      <div className="invitation-link">
        <input
          id={id}
          type="text"
          readOnly
          dir="ltr"
          value={invitation.link}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          className="secondary small"
          onClick={() => void copy()}
        >
          {copied ? "تم النسخ" : "نسخ الرابط"}
        </button>
      </div>
      <p className="hint">
        ينتهي الرابط في {formatDateTime(invitation.expiresAt)}. لن يظهر مرة
        أخرى؛ لإصدار رابط جديد استخدم «إعادة إرسال الدعوة».
      </p>
      <div className="form-actions">
        <button type="button" className="secondary small" onClick={onDismiss}>
          تم
        </button>
      </div>
    </div>
  );
}

/**
 * Creating a person and assigning their roles are two requests, because they
 * are two permissions (see the API's createUserSchema). If the first succeeds
 * and the second fails, the person exists without roles and the form says so,
 * rather than pretending the whole thing failed.
 */
function NewUserForm({
  roles,
  adminRoles,
  canManageRoles,
  onDone,
}: {
  /** Null when the reader lacks `roles.view`; the checklist is then absent. */
  roles: Role[] | null;
  adminRoles: Set<string>;
  canManageRoles: boolean;
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fullNameAr, setFullNameAr] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleIds, setRoleIds] = useState<Set<string>>(new Set());
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const create = useCreateUser();
  const setRoles = useSetRolesOfUser();

  function toggle(roleId: string) {
    setRoleIds((current) => {
      const next = new Set(current);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const wantRoles = canManageRoles && roles !== null && roleIds.size > 0;

    create.mutate(
      {
        email: email.trim(),
        fullNameAr: fullNameAr.trim(),
        fullName: fullName.trim(),
      },
      {
        onSuccess: ({ user, invitation }) => {
          setIssued(invitation);
          if (wantRoles) {
            setRoles.mutate({ userId: user.id, roleIds: [...roleIds] });
          }
        },
      },
    );
  }

  if (issued) {
    return (
      <div className="role-editor">
        <h3>تم إنشاء حساب {fullNameAr.trim()}</h3>
        {setRoles.error && (
          <p className="state denied" role="alert">
            أُنشئ الحساب لكن تعذّر إسناد الأدوار. يمكنك إسنادها من صف المستخدم.
          </p>
        )}
        {setRoles.isPending && (
          <p className="hint" role="status">
            جارٍ إسناد الأدوار…
          </p>
        )}
        <InvitationIssued invitation={issued} onDismiss={onDone} />
      </div>
    );
  }

  const error = messageFor(create.error);

  return (
    <form className="role-editor" onSubmit={handleSubmit} noValidate>
      <h3>مستخدم جديد</h3>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="field">
        <label htmlFor="new-user-email">البريد الإلكتروني</label>
        <input
          id="new-user-email"
          type="email"
          dir="ltr"
          autoComplete="off"
          required
          value={email}
          disabled={create.isPending}
          onChange={(e) => setEmail(e.target.value)}
        />
        <p className="hint">
          يُستخدم لتسجيل الدخول، ولا يمكن تغييره لاحقاً من هذه الشاشة.
        </p>
      </div>

      <div className="field">
        <label htmlFor="new-user-name-ar">الاسم (عربي)</label>
        <input
          id="new-user-name-ar"
          type="text"
          required
          value={fullNameAr}
          disabled={create.isPending}
          onChange={(e) => setFullNameAr(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="new-user-name">الاسم (لاتيني)</label>
        <input
          id="new-user-name"
          type="text"
          dir="ltr"
          required
          value={fullName}
          disabled={create.isPending}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>

      {canManageRoles && roles !== null ? (
        <fieldset className="permission-groups">
          <legend>الأدوار</legend>
          <div className="permission-group">
            {roles.map((role) => (
              <label key={role.id} className="toggle permission-toggle">
                <input
                  type="checkbox"
                  checked={roleIds.has(role.id)}
                  disabled={create.isPending}
                  onChange={() => toggle(role.id)}
                />
                {role.name}
                {adminRoles.has(role.id) && (
                  <span className="muted"> (إداري)</span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="hint">
          يُنشأ الحساب بلا أدوار. إسناد الأدوار يتطلب صلاحيتَي «عرض الأدوار
          والصلاحيات» و«إدارة الأدوار والصلاحيات».
        </p>
      )}

      <div className="form-actions">
        <button type="submit" disabled={create.isPending}>
          {create.isPending ? "جارٍ الإنشاء…" : "إنشاء الحساب وإصدار الدعوة"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={create.isPending}
          onClick={onDone}
        >
          إلغاء
        </button>
      </div>
    </form>
  );
}

const INVITATION_LABELS: Record<Invitation["status"], string | null> = {
  pending: "بانتظار تعيين كلمة المرور",
  expired: "انتهت صلاحية الدعوة",
  revoked: "أُلغيت الدعوة",
  accepted: null,
};

type RowMode = "view" | "roles" | "names";

function UserRow({
  user,
  roles,
  adminRoles,
  held,
  invitation,
  canManageRoles,
  canManageUsers,
  isSelf,
  isSoleAdministrator,
}: {
  user: DirectoryUser;
  /** Null when the reader lacks `roles.view`. */
  roles: Role[] | null;
  adminRoles: Set<string>;
  held: Set<string>;
  invitation: Invitation | null;
  canManageRoles: boolean;
  canManageUsers: boolean;
  isSelf: boolean;
  isSoleAdministrator: boolean;
}) {
  const [mode, setMode] = useState<RowMode>("view");
  const [draft, setDraft] = useState<Set<string>>(held);
  const [nameAr, setNameAr] = useState(user.fullNameAr ?? "");
  const [name, setName] = useState(user.fullName);
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const set = useSetUserRoles(user.id);
  const update = useUpdateUser(user.id);
  const disable = useDisableUser(user.id);
  const enable = useEnableUser(user.id);
  const resend = useResendInvitation(user.id);

  const heldNames = (roles ?? [])
    .filter((r) => held.has(r.id))
    .map((r) => r.name);
  const disabled = user.disabledAt !== null;
  const invitationLabel =
    invitation && !disabled ? INVITATION_LABELS[invitation.status] : null;
  const canResend =
    invitation !== null && invitation.status !== "accepted" && !disabled;

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

  function saveRoles() {
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
        setMode("view");
        set.reset();
      },
    });
  }

  function saveNames(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    update.mutate(
      { fullNameAr: nameAr.trim(), fullName: name.trim() },
      {
        onSuccess: () => {
          setMode("view");
          update.reset();
        },
      },
    );
  }

  function confirmDisable() {
    const question = isSelf
      ? "أنت على وشك تعطيل حسابك. ستُنهى جلستك فوراً ولن تتمكن من تسجيل الدخول إلا إذا فعّلك مدير آخر. المتابعة؟"
      : `تعطيل حساب ${userDisplayName(user)}؟ ستُنهى جلساته فوراً ولن يتمكن من تسجيل الدخول حتى يُفعَّل مجدداً.`;

    if (window.confirm(question)) {
      disable.mutate(undefined);
    }
  }

  const busy =
    set.isPending ||
    update.isPending ||
    disable.isPending ||
    enable.isPending ||
    resend.isPending;
  const actionError = messageFor(disable.error ?? enable.error ?? resend.error);

  return (
    <li className={disabled ? "user-row muted" : "user-row"}>
      <div className="role-main">
        <div className="role-title">
          <strong>{userDisplayName(user)}</strong>
          <span className="muted" dir="ltr">
            {user.email}
          </span>
          {isSelf && (
            <span
              className="badge"
              style={{ color: "#1f3d8f", background: "#e9eefb" }}
            >
              أنت
            </span>
          )}
          {disabled && (
            <span
              className="badge"
              style={{ color: "#4a4a45", background: "#eeeeec" }}
            >
              معطّل
            </span>
          )}
          {invitationLabel && (
            <span
              className="badge"
              style={{ color: "#8a5a06", background: "#fdf3e3" }}
            >
              {invitationLabel}
            </span>
          )}
        </div>

        {mode !== "roles" && (roles !== null || disabled) && (
          <p className="role-permissions muted">
            {/* The roles are a section of this screen, not its subject: a
                reader without roles.view gets the row without this column
                rather than a column they cannot fill. */}
            {roles !== null &&
              (heldNames.length === 0 ? "بلا أدوار" : heldNames.join(" · "))}
            {disabled &&
              user.disabledAt &&
              `${roles !== null ? " · " : ""}عُطّل في ${formatDateTime(user.disabledAt)}`}
          </p>
        )}

        {mode === "names" && (
          <form className="role-checklist" onSubmit={saveNames} noValidate>
            {update.error && (
              <p className="error" role="alert">
                {messageFor(update.error)}
              </p>
            )}
            <div className="task-form-row-inline">
              <div className="field">
                <label htmlFor={`name-ar-${user.id}`}>الاسم (عربي)</label>
                <input
                  id={`name-ar-${user.id}`}
                  type="text"
                  required
                  value={nameAr}
                  disabled={update.isPending}
                  onChange={(e) => setNameAr(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor={`name-${user.id}`}>الاسم (لاتيني)</label>
                <input
                  id={`name-${user.id}`}
                  type="text"
                  dir="ltr"
                  required
                  value={name}
                  disabled={update.isPending}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" disabled={update.isPending}>
                {update.isPending ? "جارٍ الحفظ…" : "حفظ"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={update.isPending}
                onClick={() => {
                  setMode("view");
                  setNameAr(user.fullNameAr ?? "");
                  setName(user.fullName);
                  update.reset();
                }}
              >
                إلغاء
              </button>
            </div>
          </form>
        )}

        {mode === "roles" && roles !== null && (
          <div className="role-checklist">
            {roles.map((role) => {
              // An administrator role held by the only administrator: unticking
              // would be refused at commit, so it is locked with the reason.
              const locked =
                isSoleAdministrator &&
                adminRoles.has(role.id) &&
                held.has(role.id);

              return (
                <label key={role.id} className="toggle permission-toggle">
                  <input
                    type="checkbox"
                    checked={draft.has(role.id)}
                    disabled={locked || set.isPending}
                    onChange={() => toggle(role.id)}
                  />
                  {role.name}
                  {adminRoles.has(role.id) && (
                    <span className="muted"> (إداري)</span>
                  )}
                  {locked && <span className="hint"> — {LAST_ADMIN}</span>}
                </label>
              );
            })}

            {removingOwnAdmin && (
              <p className="state denied" role="status">
                تنبيه: هذا التغيير ينزع صلاحية الإدارة من نفسك. سيُطلب تأكيدك
                عند الحفظ.
              </p>
            )}

            {set.error && (
              <p className="field-error" role="alert">
                {messageFor(set.error)}
              </p>
            )}

            <div className="form-actions">
              <button
                type="button"
                disabled={set.isPending}
                onClick={saveRoles}
              >
                {set.isPending ? "جارٍ الحفظ…" : "حفظ"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={set.isPending}
                onClick={() => {
                  setMode("view");
                  setDraft(held);
                  set.reset();
                }}
              >
                إلغاء
              </button>
            </div>
          </div>
        )}

        {issued && mode === "view" && (
          <InvitationIssued
            invitation={issued}
            onDismiss={() => setIssued(null)}
          />
        )}

        {actionError && mode === "view" && (
          <p className="field-error" role="alert">
            {actionError}
          </p>
        )}

        {/* Disabling the sole administrator would be refused at commit; the
            control is locked with the same sentence the server would answer. */}
        {canManageUsers &&
          !disabled &&
          isSoleAdministrator &&
          mode === "view" && (
            <p className="hint">لا يمكن تعطيل هذا الحساب — {LAST_ADMIN}</p>
          )}
      </div>

      {mode === "view" && (canManageUsers || canManageRoles) && (
        <div className="task-actions">
          {canManageUsers && !disabled && (
            <button
              type="button"
              className="link"
              disabled={busy}
              onClick={() => setMode("names")}
            >
              تعديل
            </button>
          )}
          {canManageRoles && roles !== null && !disabled && (
            <button
              type="button"
              className="link"
              disabled={busy}
              onClick={() => {
                setDraft(held);
                setMode("roles");
              }}
            >
              تغيير الأدوار
            </button>
          )}
          {canManageUsers && canResend && (
            <button
              type="button"
              className="link"
              disabled={busy}
              onClick={() =>
                resend.mutate(undefined, {
                  onSuccess: (result) => {
                    setIssued(result);
                    resend.reset();
                  },
                })
              }
            >
              {resend.isPending ? "جارٍ الإصدار…" : "إعادة إرسال الدعوة"}
            </button>
          )}
          {canManageUsers && !disabled && (
            <button
              type="button"
              className="link"
              disabled={busy || isSoleAdministrator}
              onClick={confirmDisable}
            >
              {disable.isPending ? "جارٍ التعطيل…" : "تعطيل"}
            </button>
          )}
          {canManageUsers && disabled && (
            <button
              type="button"
              className="link"
              disabled={busy}
              onClick={() => enable.mutate(undefined)}
            >
              {enable.isPending ? "جارٍ التفعيل…" : "تفعيل"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

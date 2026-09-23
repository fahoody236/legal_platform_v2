import { Link } from "@tanstack/react-router";
import { useHasPermission } from "../lib/session.js";

/**
 * The settings screens, each marked when current.
 *
 * A tab appears only where the reader can read what is behind it. That is a
 * departure from the section navigation in the sidebar, which lists every
 * section and lets each screen explain a refusal — and the reason for the
 * difference is that these two are not parallel places. Whether the roles
 * screen exists is itself administrative information, and someone who only
 * manages people has no use for knowing it is there.
 *
 * Renders nothing at all when neither permission is held, which happens when
 * someone types a settings URL: the screen's own refusal is then the whole
 * page, with no tabs offering a second refusal beside it.
 */
export function SettingsNav() {
  const canSeeRoles = useHasPermission("roles.view");
  const canManageUsers = useHasPermission("users.manage");

  if (!canSeeRoles && !canManageUsers) {
    return null;
  }

  return (
    <nav className="settings-nav" aria-label="الإعدادات">
      {canSeeRoles && (
        <Link to="/settings/roles" activeProps={{ className: "current" }}>
          الأدوار
        </Link>
      )}
      <Link to="/settings/users" activeProps={{ className: "current" }}>
        المستخدمون
      </Link>
    </nav>
  );
}

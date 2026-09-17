import { Link } from "@tanstack/react-router";

/** The two settings screens, each marked when current. */
export function SettingsNav() {
  return (
    <nav className="settings-nav" aria-label="الإعدادات">
      <Link to="/settings/roles" activeProps={{ className: "current" }}>
        الأدوار
      </Link>
      <Link to="/settings/users" activeProps={{ className: "current" }}>
        المستخدمون
      </Link>
    </nav>
  );
}

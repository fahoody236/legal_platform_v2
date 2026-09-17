import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { apiFetch } from "../lib/api.js";
import {
  displayName,
  useHasPermission,
  useSession,
  type SessionUser,
} from "../lib/session.js";
import { GlobalSearch } from "./global-search.js";
import {
  BriefcaseIcon,
  CheckSquareIcon,
  CloseIcon,
  DashboardIcon,
  LogOutIcon,
  MenuIcon,
  SettingsIcon,
  UsersIcon,
} from "./icons.js";

/** The width below which the sidebar leaves the flow; matches the stylesheet. */
const NARROW = "(max-width: 48rem)";

/**
 * The frame around every signed-in screen: the sidebar with the sections, the
 * top bar with the search, and the page itself.
 *
 * This is the component of a pathless layout route, so it renders once and the
 * screens swap inside it through the Outlet. The sidebar therefore never
 * re-mounts between screens, its scroll position survives navigation, and a
 * screen cannot forget to include it — which the previous header-based
 * navigation allowed, and the detail screens did.
 */
export function AppShell() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const sidebarId = useId();

  // Navigating closes the drawer. The person chose a place to go; the menu has
  // done its job, and leaving it open would cover the screen they asked for.
  useEffect(() => setOpen(false), [location.pathname]);

  // Escape closes it, and focus goes back to the button that opened it, so a
  // keyboard user is returned to where they were rather than dropped at the
  // top of the page.
  useEffect(() => {
    if (!open) return;

    sidebar.current?.querySelector<HTMLElement>("a, button")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Widening the window past the breakpoint while the drawer is open would
  // leave a backdrop over a sidebar that is now part of the layout.
  useEffect(() => {
    const query = window.matchMedia(NARROW);
    function onChange() {
      if (!query.matches) setOpen(false);
    }
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="shell">
      <Sidebar
        ref={sidebar}
        id={sidebarId}
        open={open}
        onClose={() => {
          setOpen(false);
          menuButton.current?.focus();
        }}
      />

      {open && (
        // Presentation only: the backdrop is a click target for closing, and
        // Escape covers the keyboard. The sidebar's own close button is the
        // accessible control.
        <div className="sidebar-backdrop" onClick={() => setOpen(false)} />
      )}

      <div className="shell-main">
        <div className="topbar">
          <button
            ref={menuButton}
            type="button"
            className="icon-button menu-button"
            aria-controls={sidebarId}
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            <MenuIcon />
            <span className="sr-only">القائمة</span>
          </button>

          <span className="brand-name">المنصة القانونية</span>

          <GlobalSearch />
        </div>

        <div className="page">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

/**
 * Every section is always listed, including the one the reader is in — a
 * navigation that hides the current item makes the set of places change as
 * you move through it, so nobody can learn its shape. `activeProps` marks the
 * current one instead.
 *
 * The links are not hidden for want of `cases.view` or `clients.view` either.
 * A person who cannot read clients still benefits from knowing the section
 * exists and being told why they cannot open it — which the screen does — far
 * more than from a navigation that quietly differs from their colleague's.
 *
 * Settings is the one exception: administration that most of a firm cannot
 * enter is noise in their navigation, not a place they should know exists.
 */
function Sidebar({
  ref,
  id,
  open,
  onClose,
}: {
  ref: React.RefObject<HTMLElement | null>;
  id: string;
  open: boolean;
  onClose: () => void;
}) {
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canSeeSettings = useHasPermission("roles.view");

  async function signOut() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Already signed out, or unreachable. Either way the local answer is the
      // same, and there is nothing useful to say about a session that is gone.
    }

    queryClient.clear();
    void navigate({ to: "/login" });
  }

  const user = session.data?.user;

  // One entry for both settings screens: the link leads to the first, and is
  // marked current from either, which `activeProps` alone would not do.
  const inSettings = useLocation().pathname.startsWith("/settings");

  return (
    <aside ref={ref} id={id} className={open ? "sidebar open" : "sidebar"}>
      <div className="brand">
        <Link to="/dashboard" className="brand-link">
          <span className="brand-mark" aria-hidden="true">
            ق
          </span>
          <span>
            <span className="brand-name">المنصة القانونية</span>
            <span className="brand-sub">إدارة المكتب</span>
          </span>
        </Link>
        {open && (
          <button type="button" className="icon-button" onClick={onClose}>
            <CloseIcon />
            <span className="sr-only">إغلاق القائمة</span>
          </button>
        )}
      </div>

      <nav className="sidebar-nav" aria-label="الأقسام">
        <Link to="/dashboard" activeProps={{ className: "current" }}>
          <DashboardIcon />
          الرئيسية
        </Link>
        <Link to="/cases" search={{}} activeProps={{ className: "current" }}>
          <BriefcaseIcon />
          القضايا
        </Link>
        <Link to="/clients" search={{}} activeProps={{ className: "current" }}>
          <UsersIcon />
          العملاء
        </Link>
        <Link to="/tasks" search={{}} activeProps={{ className: "current" }}>
          <CheckSquareIcon />
          المهام
        </Link>
        {canSeeSettings && (
          <Link
            to="/settings/roles"
            className={inSettings ? "current" : undefined}
          >
            <SettingsIcon />
            الإعدادات
          </Link>
        )}
      </nav>

      {user && (
        <div className="sidebar-foot">
          <span className="avatar" aria-hidden="true">
            {initials(user)}
          </span>
          <span className="sidebar-identity">
            <strong>{displayName(user)}</strong>
            <span dir="ltr">{user.email}</span>
          </span>
          <button type="button" className="icon-button" onClick={signOut}>
            <LogOutIcon className="mirror" />
            <span className="sr-only">تسجيل الخروج</span>
          </button>
        </div>
      )}
    </aside>
  );
}

/**
 * The first letter of the name, for the avatar.
 *
 * One letter, not two: Arabic letters join, so the initials of «بدر الحمودي»
 * would render as the word «با» rather than as two marks. A Latin name gets
 * its capital.
 */
function initials(user: SessionUser): string {
  return displayName(user).trim().charAt(0).toUpperCase();
}

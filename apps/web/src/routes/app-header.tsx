import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { apiFetch } from "../lib/api.js";
import { displayName, useSession } from "../lib/session.js";

/**
 * The heading shared by the list screens, carrying the navigation between them.
 *
 * Both links are always shown, including the one to the section the reader is
 * already in — a navigation that hides the current item makes the set of places
 * change as you move through it, so nobody can learn its shape. `activeProps`
 * marks the current one instead.
 *
 * The links are not hidden for want of `cases.view` or `clients.view` either.
 * A person who cannot read clients still benefits from knowing the section
 * exists and being told why they cannot open it — which the screen does — far
 * more than from a navigation that quietly differs from their colleague's.
 */
export function AppHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  return (
    <>
      <nav className="app-nav" aria-label="الأقسام">
        <Link to="/cases" search={{}} activeProps={{ className: "current" }}>
          القضايا
        </Link>
        <Link to="/clients" search={{}} activeProps={{ className: "current" }}>
          العملاء
        </Link>

        {session.data && (
          <span className="identity">
            <span>{displayName(session.data.user)}</span>
            <button type="button" className="link" onClick={signOut}>
              تسجيل الخروج
            </button>
          </span>
        )}
      </nav>

      <header className="page-header">
        <h1>{title}</h1>
        {actions && <div className="identity">{actions}</div>}
      </header>
    </>
  );
}

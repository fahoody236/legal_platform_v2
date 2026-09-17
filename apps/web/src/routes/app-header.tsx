import type { ReactNode } from "react";

/**
 * The heading of a screen: its title and, beside it, the actions that belong
 * to the whole screen rather than to one row.
 *
 * Navigation used to live here too, which meant a screen that did not render
 * this header had no navigation — and the detail screens did not. It now lives
 * in the shell (app-shell.tsx), around every signed-in screen, so this is only
 * what its name says.
 */
export function AppHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

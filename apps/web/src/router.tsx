import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { apiFetch, ApiError } from "./lib/api.js";
import { CASE_STATUSES, type CaseStatus } from "./lib/cases.js";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "./lib/tasks.js";
import { CLIENT_TYPES, type ClientType } from "./lib/clients.js";
import type { SessionUser } from "./lib/session.js";
import { AppShell } from "./routes/app-shell.js";
import { CaseDetailPage } from "./routes/case-detail.js";
import { CaseNewPage } from "./routes/case-new.js";
import { ClientDetailPage } from "./routes/client-detail.js";
import { ClientNewPage } from "./routes/client-new.js";
import { ClientsPage } from "./routes/clients.js";
import { DashboardPage } from "./routes/dashboard.js";
import { TasksPage } from "./routes/tasks.js";
import { CasesPage } from "./routes/cases.js";
import { LoginPage } from "./routes/login.js";
import { RouteError } from "./routes/route-error.js";
import { SettingsRolesPage } from "./routes/settings-roles.js";
import { SettingsUsersPage } from "./routes/settings-users.js";

/**
 * Code-based routes rather than file-based.
 *
 * File-based routing needs a Vite plugin and a generated route tree checked into
 * the repository. For a handful of routes that is a build step and a generated
 * artefact to keep honest, in exchange for nothing — the tree below is shorter
 * than the generated one would be.
 */

const rootRoute = createRootRoute({ component: Outlet });

/**
 * The list's filter and page, carried by the list route and by the detail route
 * alike.
 *
 * The detail route validates the same shape not because it filters anything,
 * but because it has to hand them back: the link out of a case returns to the
 * exact page of the exact filter the reader came from. Keeping them in the URL
 * rather than in history state means that still works after a reload, and that
 * a link to a case can carry the context it belongs to.
 *
 * Both are validated rather than trusted. A hand-edited `?status=deleted`
 * becomes "no filter" instead of reaching the API as a 400 the screen would
 * have to render as a mysterious failure.
 */
interface CasesSearch {
  status?: CaseStatus | undefined;
  offset?: number | undefined;
}

function validateCasesSearch(search: Record<string, unknown>): CasesSearch {
  const status = CASE_STATUSES.includes(search["status"] as CaseStatus)
    ? (search["status"] as CaseStatus)
    : undefined;

  const rawOffset = Number(search["offset"]);
  const offset =
    Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : undefined;

  return { status, offset };
}

/**
 * No session, no case data.
 *
 * This asks the server rather than reading anything local, because the session
 * cookie is HttpOnly and there is nothing local to read. It is also not a
 * security control — the API refuses unauthenticated requests on its own, and
 * would do so if this were deleted. What it buys is that an expired session
 * lands on the sign-in form instead of on a screen full of error states.
 *
 * A 403 is deliberately *not* handled here. Being signed in without
 * `cases.view` is a different situation from not being signed in, and bouncing
 * such a person to a login form they have already completed would tell them
 * nothing. The screen renders and explains.
 */
async function requireSession(): Promise<void> {
  try {
    await apiFetch<{ user: SessionUser }>("/api/auth/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw redirect({ to: "/login" });
    }

    throw error;
  }
}

/**
 * The signed-in half of the application, as one pathless layout route.
 *
 * It owns the session check and the shell — sidebar, top bar, page — and every
 * screen below it renders inside that shell through its Outlet. Putting the
 * check here rather than on each child means a screen cannot be added without
 * it, and putting the shell here means it cannot be added without navigation
 * either, which the header-based navigation before this allowed: the detail
 * screens simply had none.
 *
 * A failure in `beforeLoad` here — the session request itself failing — renders
 * RouteError in place of the whole shell, since without a session there is
 * nothing to put in the sidebar. A child's own failure renders inside it.
 */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: requireSession,
  component: AppShell,
  errorComponent: RouteError,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const casesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/cases",
  validateSearch: validateCasesSearch,
  component: CasesPage,
  errorComponent: RouteError,
});

/**
 * Declared before `/cases/$caseId` so "new" is matched as a literal segment
 * rather than captured as a case id. TanStack ranks static segments above
 * dynamic ones, so the order is belt and braces — but the failure it guards
 * against is a 404 for a route that exists, which is worth being explicit about.
 */
const caseNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/cases/new",
  validateSearch: validateCasesSearch,
  component: CaseNewPage,
  errorComponent: RouteError,
});

const caseDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/cases/$caseId",
  validateSearch: validateCasesSearch,
  component: CaseDetailPage,
  errorComponent: RouteError,
});

/**
 * The clients list's filters and page, carried by the list and by the screens
 * reached from it, for the same reason the cases search is: the way back has to
 * land on the page the reader left, after a reload and from a shared link.
 */
interface ClientsSearch {
  clientType?: ClientType | undefined;
  archived?: boolean | undefined;
  offset?: number | undefined;
}

function validateClientsSearch(
  search: Record<string, unknown>,
): ClientsSearch {
  const clientType = CLIENT_TYPES.includes(search["clientType"] as ClientType)
    ? (search["clientType"] as ClientType)
    : undefined;

  // Only a real boolean counts. `?archived=maybe` becomes "no filter" rather
  // than a silent false, which would quietly hide every archived client.
  const rawArchived = search["archived"];
  const archived =
    rawArchived === true || rawArchived === "true"
      ? true
      : rawArchived === false || rawArchived === "false"
        ? false
        : undefined;

  const rawOffset = Number(search["offset"]);
  const offset =
    Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : undefined;

  return { clientType, archived, offset };
}

const clientsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/clients",
  validateSearch: validateClientsSearch,
  component: ClientsPage,
  errorComponent: RouteError,
});

/** Before the dynamic route, so "new" is a literal segment and not a client id. */
const clientNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/clients/new",
  validateSearch: validateClientsSearch,
  component: ClientNewPage,
  errorComponent: RouteError,
});

const clientDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/clients/$clientId",
  validateSearch: validateClientsSearch,
  component: ClientDetailPage,
  errorComponent: RouteError,
});

/**
 * The tasks list's filters, in the URL like every other list's.
 *
 * `mine` is a boolean rather than a user id on purpose: a link to "my tasks"
 * should show the *reader* their own work, not the sender's. The id is resolved
 * from the session at request time.
 */
interface TasksSearch {
  status?: TaskStatus | undefined;
  priority?: TaskPriority | undefined;
  overdue?: boolean | undefined;
  mine?: boolean | undefined;
  offset?: number | undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function validateTasksSearch(search: Record<string, unknown>): TasksSearch {
  const status = TASK_STATUSES.includes(search["status"] as TaskStatus)
    ? (search["status"] as TaskStatus)
    : undefined;

  const priority = TASK_PRIORITIES.includes(search["priority"] as TaskPriority)
    ? (search["priority"] as TaskPriority)
    : undefined;

  const rawOffset = Number(search["offset"]);
  const offset =
    Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : undefined;

  return {
    status,
    priority,
    overdue: readBoolean(search["overdue"]),
    mine: readBoolean(search["mine"]),
    offset,
  };
}

const tasksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/tasks",
  validateSearch: validateTasksSearch,
  component: TasksPage,
  errorComponent: RouteError,
});

const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/dashboard",
  component: DashboardPage,
  errorComponent: RouteError,
});

const settingsRolesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings/roles",
  component: SettingsRolesPage,
  errorComponent: RouteError,
});

const settingsUsersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings/users",
  component: SettingsUsersPage,
  errorComponent: RouteError,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  appRoute.addChildren([
    dashboardRoute,
    casesRoute,
    caseNewRoute,
    caseDetailRoute,
    clientsRoute,
    clientNewRoute,
    clientDetailRoute,
    tasksRoute,
    settingsRolesRoute,
    settingsUsersRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

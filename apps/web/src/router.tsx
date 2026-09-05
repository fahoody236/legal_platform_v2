import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { apiFetch, ApiError } from "./lib/api.js";
import { CASE_STATUSES, type CaseStatus } from "./lib/cases.js";
import type { SessionUser } from "./lib/session.js";
import { CasesPage } from "./routes/cases.js";
import { LoginPage } from "./routes/login.js";

/**
 * Code-based routes rather than file-based.
 *
 * File-based routing needs a Vite plugin and a generated route tree checked into
 * the repository. For two routes that is a build step and a generated artefact
 * to keep honest, in exchange for nothing — the tree below is shorter than the
 * generated one would be.
 */

const rootRoute = createRootRoute({ component: Outlet });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/cases" });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

interface CasesSearch {
  status?: CaseStatus | undefined;
  offset?: number | undefined;
}

export const casesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cases",

  /**
   * The filter and the page are URL state, so they survive a reload and can be
   * shared. Both are validated here rather than trusted: a hand-edited
   * `?status=deleted` becomes "no filter" instead of reaching the API as a 400
   * the screen would have to render as a mysterious failure.
   */
  validateSearch: (search: Record<string, unknown>): CasesSearch => {
    const status = CASE_STATUSES.includes(search["status"] as CaseStatus)
      ? (search["status"] as CaseStatus)
      : undefined;

    const rawOffset = Number(search["offset"]);
    const offset =
      Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : undefined;

    return { status, offset };
  },

  /**
   * The route's own guard: no session, no cases screen.
   *
   * This asks the server rather than reading anything local, because the session
   * cookie is HttpOnly and there is nothing local to read. It is also not a
   * security control — the API refuses unauthenticated requests on its own, and
   * would do so if this were deleted. What it buys is that an expired session
   * lands on the sign-in form instead of on a screen full of error states.
   *
   * A 403 is deliberately *not* handled here. Being signed in without
   * `cases.view` is a different situation from not being signed in, and
   * bouncing such a person to a login form they have already completed would
   * tell them nothing. The screen renders and explains.
   */
  beforeLoad: async () => {
    try {
      await apiFetch<{ user: SessionUser }>("/api/auth/me");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw redirect({ to: "/login" });
      }

      throw error;
    }
  },

  component: CasesPage,
});

const routeTree = rootRoute.addChildren([indexRoute, loginRoute, casesRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

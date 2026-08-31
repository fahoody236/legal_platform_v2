import type { TenantRequest } from "../tenant/tenant-request.js";
import type { AuthenticatedSession } from "./auth.service.js";

/**
 * The authenticated principal, carried on the request under a symbol for the
 * same reasons as the resolved firm: nothing can collide with it, and nothing
 * can forge it by assigning a plausible-looking property.
 */
const SESSION = Symbol("legal.session");

export interface AuthenticatedRequest extends TenantRequest {
  [SESSION]?: AuthenticatedSession;
}

export function setSession(
  request: AuthenticatedRequest,
  session: AuthenticatedSession,
): void {
  request[SESSION] = session;
}

export function getSession(
  request: AuthenticatedRequest,
): AuthenticatedSession | undefined {
  return request[SESSION];
}

/**
 * For handlers behind the guard, where an absent session is a wiring bug rather
 * than a case to handle — throwing beats returning undefined and letting a
 * caller treat "nobody" as a user.
 */
export function requireSession(
  request: AuthenticatedRequest,
): AuthenticatedSession {
  const session = getSession(request);

  if (!session) {
    throw new Error(
      "No authenticated session on this request. SessionGuard must run before " +
        "any handler that reads it.",
    );
  }

  return session;
}

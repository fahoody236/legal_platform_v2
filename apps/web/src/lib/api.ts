/**
 * The one place this application talks to the API.
 *
 * Two things every request needs and none of them should have to remember:
 * `credentials: "include"`, without which the session cookie is neither sent
 * nor stored, and a status check — `fetch` resolves happily on a 403, so code
 * that only catches rejections treats "you are not allowed" as success with a
 * strange body.
 */

/**
 * An HTTP failure, carrying the status so a screen can distinguish the cases it
 * genuinely has to handle: 401 means the session is gone, 403 means this person
 * lacks a permission, and everything else is the same unexpected failure.
 */
export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    // The session token is an HttpOnly cookie: the browser stores and replays
    // it, and this is what allows it to. Nothing here ever sees the token.
    credentials: "include",
    headers:
      init?.body === undefined
        ? init?.headers
        : { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  return (await response.json()) as T;
}

export function isApiError(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status;
}

/**
 * True when the request never reached the server — offline, DNS, a dropped
 * connection, a rejected TLS handshake. `fetch` rejects for those and resolves
 * for everything the server answers, so the absence of an ApiError is exactly
 * the distinction.
 *
 * Worth telling apart from a server error because the action differs: check the
 * connection and retry, rather than report a fault that is not on this side.
 */
export function isNetworkError(error: unknown): boolean {
  return !(error instanceof ApiError);
}

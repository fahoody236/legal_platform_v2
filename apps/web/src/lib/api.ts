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
  constructor(
    readonly status: number,
    /**
     * A machine-readable reason, when the API sends one. Almost no route does:
     * the status alone is enough to tell a 404 from a 409. The exception is a
     * 409 that has two causes on the same route — a duplicate name and the
     * last-administrator rule — which the interface has to word differently.
     */
    readonly code?: string,
    /**
     * Seconds to wait, from a 429's `Retry-After`. Undefined on every other
     * status, and on a 429 that for some reason did not say.
     */
    readonly retryAfterSeconds?: number,
  ) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
  }

  /**
   * A 429 that stands in for a 401: the address has produced too many
   * unauthenticated requests, and this was one more. Treated as "not signed
   * in", because that is what it means — the sign-in route is not subject to
   * that limit, so the way out is the same.
   */
  get isUnauthenticated(): boolean {
    return this.status === 401 || (this.status === 429 && this.code === "unauthenticated");
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
    // FormData sets its own multipart Content-Type, boundary included; naming
    // JSON over it would make the server parse an upload as a JSON body.
    headers:
      init?.body === undefined || init.body instanceof FormData
        ? init?.headers
        : { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    throw new ApiError(
      response.status,
      await errorCode(response),
      retryAfterOf(response),
    );
  }

  // A 204 has no body to parse. Sign-out and accepting an invitation answer
  // that way; without this line the first was "succeeding" by throwing into
  // a catch block that ignored it.
  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * Reads `{ code }` out of an error body, if there is one. Bodies are optional
 * and usually absent; anything unparseable is treated as absent rather than as
 * a second failure.
 */
async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "code" in body) {
      const code = (body as { code: unknown }).code;
      return typeof code === "string" ? code : undefined;
    }
  } catch {
    // No body, or not JSON.
  }
  return undefined;
}

function retryAfterOf(response: Response): number | undefined {
  if (response.status !== 429) return undefined;
  const header = response.headers.get("Retry-After");
  const seconds = header === null ? NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/** True when the request means "sign in": a 401, or the 429 that stands in for one. */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.isUnauthenticated;
}

/** Arabic, with the wait if the server gave one. */
export function rateLimitedMessage(error: unknown): string {
  const seconds = error instanceof ApiError ? error.retryAfterSeconds : undefined;
  if (seconds === undefined) {
    return "طلبات كثيرة في وقت قصير. انتظر قليلاً ثم حاول مرة أخرى.";
  }
  const wait =
    seconds >= 120
      ? `${Math.ceil(seconds / 60)} دقيقة`
      : `${seconds} ثانية`;
  return `طلبات كثيرة في وقت قصير. حاول مرة أخرى بعد ${wait}.`;
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

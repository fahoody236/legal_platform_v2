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
 * A multipart upload with progress.
 *
 * `fetch` cannot report how much of a request body has been sent, and a
 * 50 MB file over office wifi takes long enough that a button saying
 * «جارٍ الرفع…» for a minute reads as a hang. XMLHttpRequest can.
 *
 * The contract is apiFetch's. The same things are sent: the session cookie
 * (`withCredentials`, which is `credentials: "include"`), and no
 * Content-Type of our own — the multipart boundary is the browser's to set,
 * exactly as apiFetch leaves it for a FormData body. apiFetch adds nothing
 * else, so neither does this. The same things come back: an ApiError with
 * the status, the body's `code` if any, and `Retry-After` on a 429 when the
 * header is present; a request that never reached the server rejects with a
 * TypeError, as fetch does, which is what isNetworkError treats as "check
 * the connection".
 */
export function uploadForm<T>(
  path: string,
  form: FormData,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", path);
    request.withCredentials = true;
    request.responseType = "text";

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.min(1, event.loaded / event.total));
      }
    };

    request.onerror = () => reject(new TypeError("Network request failed"));
    request.onabort = () => reject(new TypeError("Upload aborted"));

    request.onload = () => {
      const body = parseJson(request.responseText);

      if (request.status < 200 || request.status >= 300) {
        const code =
          typeof body === "object" && body !== null && "code" in body
            ? String((body as { code: unknown }).code)
            : undefined;
        // Absent is undefined, not zero: Number(null) is 0, and a 429 with no
        // header would otherwise tell the person to wait one second.
        const header = request.getResponseHeader("Retry-After");
        const retry = header === null ? NaN : Number(header);
        reject(
          new ApiError(
            request.status,
            code,
            request.status === 429 && Number.isFinite(retry) && retry >= 0
              ? retry
              : undefined,
          ),
        );
        return;
      }

      resolve(body as T);
    };

    request.send(form);
  });
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
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
  return `طلبات كثيرة في وقت قصير. حاول مرة أخرى بعد ${formatWait(seconds)}.`;
}

/**
 * A duration in Arabic, as it follows «بعد».
 *
 * Arabic counts agree with the number in a way a `${n} ${unit}` template
 * cannot: one and two have their own forms (دقيقة واحدة، دقيقتين), three to
 * ten take the plural (3 دقائق), and eleven upward take the singular again
 * (15 دقيقة). The unit changes with size too — seconds under a minute,
 * minutes up to an hour and a half, hours beyond that — so a day's wait reads
 * «24 ساعة» and never «1440 دقيقة». Digits stay Latin, as dates.ts chooses.
 */
export function formatWait(totalSeconds: number): string {
  const seconds = Math.max(1, Math.ceil(totalSeconds));

  if (seconds < 60) {
    return count(seconds, SECONDS);
  }

  const minutes = Math.ceil(seconds / 60);

  if (minutes <= 90) {
    return count(minutes, MINUTES);
  }

  return count(Math.ceil(minutes / 60), HOURS);
}

interface Forms {
  one: string;
  two: string;
  /** Three to ten. */
  few: string;
  /** Eleven and above. */
  many: string;
}

const SECONDS: Forms = { one: "ثانية واحدة", two: "ثانيتين", few: "ثوانٍ", many: "ثانية" };
const MINUTES: Forms = { one: "دقيقة واحدة", two: "دقيقتين", few: "دقائق", many: "دقيقة" };
const HOURS: Forms = { one: "ساعة واحدة", two: "ساعتين", few: "ساعات", many: "ساعة" };

function count(n: number, forms: Forms): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (n <= 10) return `${n} ${forms.few}`;
  return `${n} ${forms.many}`;
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

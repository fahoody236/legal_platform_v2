/**
 * ── Why the session token travels in an httpOnly cookie, not the response body ─
 *
 * A token returned in the body has to be stored by the client, and every place
 * a browser can store it — localStorage, sessionStorage, a variable, IndexedDB —
 * is readable by any JavaScript running on the origin. One cross-site scripting
 * flaw anywhere in the application, or in any dependency it ships, and the token
 * is read and sent elsewhere. For this product that token is a live key to
 * privileged legal files, usable later, from another machine, by someone who
 * never had a password.
 *
 * `HttpOnly` removes that. The cookie is not exposed to `document.cookie` or to
 * `fetch`, so script on the page cannot read it. XSS remains serious — an
 * attacker can still make requests that ride the cookie — but the damage is
 * bounded by the page being open and the session being live, rather than being a
 * durable stolen credential. Session hijacking and credential theft are
 * different incidents, and this is the line between them.
 *
 * It also means no client code ever handles the secret. A value the application
 * never touches cannot be logged by it, attached to an error report, sent to an
 * analytics endpoint, or pasted into a URL — routes by which tokens leak far
 * more often than through XSS.
 *
 * ── What choosing cookies costs, and how that is paid ────────────────────────
 *
 * Cookies are attached automatically, which is what creates cross-site request
 * forgery: another site can cause the browser to issue a request carrying them.
 * `SameSite=Strict` is the answer — the browser withholds the cookie on any
 * request originating from another site, including top-level navigation. Strict
 * rather than Lax because there is no cross-site entry flow worth preserving
 * here; this is an application people sign in to, not a link target.
 *
 * `Secure` keeps it off plaintext connections entirely.
 *
 * ── One property specific to this platform ───────────────────────────────────
 *
 * No `Domain` attribute is set, deliberately. A cookie without one is scoped to
 * the exact host that issued it, so a session created on
 * `alhumoudi.platform.sa` is never sent to another firm's subdomain. Setting
 * `Domain=.platform.sa` would share it across every tenant and make the browser
 * a cross-tenant channel — precisely the boundary the rest of the system spends
 * its effort maintaining. The omission is the control.
 */

const SESSION_COOKIE = "session";

const isProduction = process.env["NODE_ENV"] === "production";

/**
 * Local development runs over http, where a `Secure` cookie is discarded by the
 * browser. Refused in production for the same reason as the tenant override: a
 * flag that silently weakens a control must not be settable where it matters.
 */
const insecureCookies = process.env["AUTH_COOKIE_INSECURE"] === "true";

if (insecureCookies && isProduction) {
  throw new Error(
    "AUTH_COOKIE_INSECURE is set while NODE_ENV=production. It drops the Secure " +
      "attribute from the session cookie, allowing it over plaintext. Unset it.",
  );
}

export interface CookieWriter {
  setHeader(name: string, value: string | string[]): void;
}

export function readSessionCookie(
  cookieHeader: string | undefined,
): string | undefined {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;

    if (part.slice(0, separator).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return undefined;
}

function serialise(value: string, maxAgeSeconds: number): string {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (!insecureCookies) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function setSessionCookie(
  response: CookieWriter,
  token: string,
  expiresAt: Date,
): void {
  const maxAge = Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  );
  response.setHeader("Set-Cookie", serialise(token, maxAge));
}

export function clearSessionCookie(response: CookieWriter): void {
  response.setHeader("Set-Cookie", serialise("", 0));
}

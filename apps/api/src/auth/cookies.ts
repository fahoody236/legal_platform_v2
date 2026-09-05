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

import type { Socket } from "node:net";

const SESSION_COOKIE = "session";

const isProduction = process.env["NODE_ENV"] === "production";

/**
 * The wide escape hatch: drop `Secure` for every response, whatever the request.
 *
 * Rarely needed now that plaintext loopback is handled automatically below, but
 * kept for the case that rule deliberately does not cover — reaching a
 * development server over http on a LAN address, from a phone or another
 * machine. Refused in production for the same reason as the tenant override: a
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

/**
 * Enough of the request to decide whether `Secure` can work at all.
 *
 * `socket` is the real `net.Socket` rather than `{ encrypted?: boolean }`,
 * because TLS is signalled by the socket being a `TLSSocket` — a subtype that
 * adds the property — and a structural type of only-optional members matches
 * almost anything, which would let an unrelated object be passed here by
 * mistake.
 */
export interface CookieRequest {
  headers: { host?: string | undefined };
  socket: Socket;
}

/**
 * `localhost` and anything under it, the whole 127.0.0.0/8 range, and IPv6 ::1.
 *
 * `*.localhost` is included on purpose and is not a loosening. Tenants are
 * identified by subdomain (docs/decisions/0003-tenant-identification.md), so the
 * realistic local setup is `firma.localhost`, not bare `localhost` — the
 * `DEV_FIRM_SUBDOMAIN` override exists precisely because bare localhost has no
 * subdomain to read. A rule that covered only `localhost` would send `Secure`
 * to exactly the hostname a developer testing multi-tenancy actually uses, and
 * reproduce this bug for them.
 *
 * `*.localhost` resolves to the loopback interface by convention (RFC 6761), so
 * it reaches no further than the other entries here.
 */
function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

/**
 * ── Why `Secure` is dropped on plaintext loopback ────────────────────────────
 *
 * A `Secure` cookie is discarded by the browser when it arrives over http. What
 * makes this a browser-specific bug rather than an obvious one is that Chrome
 * carves out an exception: it treats `http://localhost` as a secure context and
 * accepts `Secure` cookies there. Safari has no such exception and follows the
 * rule as written, so on Safari the sign-in response is a clean 200 whose
 * `Set-Cookie` the browser silently throws away. The next request has no
 * session, `/auth/me` answers 401, and the interface bounces back to the sign-in
 * form having apparently done nothing. Nothing errors, and nothing is logged.
 *
 * ── Why this is decided per request rather than by configuration ─────────────
 *
 * The previous arrangement — an `AUTH_COOKIE_INSECURE` flag — worked but had to
 * be remembered, and forgetting it produced exactly the silent failure above in
 * one browser and not the other. A flag whose absence breaks sign-in invisibly
 * is a flag that will be forgotten.
 *
 * The condition below is derived from the request itself, so there is nothing to
 * set and nothing to forget. It also cannot weaken production, and not as a
 * matter of discipline: both halves must hold at once. The connection must be
 * genuinely unencrypted — read from the socket, never from `X-Forwarded-Proto`,
 * which any client can send and which this application does not trust — and the
 * `Host` must be a loopback name. A real deployment satisfies neither: it is
 * behind TLS, and its `Host` is a firm's subdomain. A request that lies about
 * its `Host` still fails the socket half.
 *
 * The narrow reading matters: this does not say "in development, skip Secure".
 * It says "where a Secure cookie could not survive the trip anyway, do not send
 * one" — and that is only ever true where there is nothing to protect it from.
 */
function secureAttributeApplies(request: CookieRequest): boolean {
  if (insecureCookies) {
    return false;
  }

  // `encrypted` exists only on a TLSSocket, so its presence is the connection
  // being genuinely TLS-terminated by this process.
  if (
    "encrypted" in request.socket &&
    (request.socket as { encrypted?: unknown }).encrypted === true
  ) {
    return true;
  }

  const host = request.headers.host ?? "";
  // Strip the port. IPv6 hosts arrive bracketed, so the last colon is the port
  // separator only when it comes after the closing bracket.
  const hostname = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : (host.split(":")[0] ?? "");

  return !isLoopbackHostname(hostname.toLowerCase());
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

function serialise(
  value: string,
  maxAgeSeconds: number,
  request: CookieRequest,
): string {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (secureAttributeApplies(request)) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function setSessionCookie(
  response: CookieWriter,
  request: CookieRequest,
  token: string,
  expiresAt: Date,
): void {
  const maxAge = Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  );
  response.setHeader("Set-Cookie", serialise(token, maxAge, request));
}

/**
 * Takes the request for the same reason as `setSessionCookie`, and it is not
 * symmetry for its own sake: a deletion is itself a `Set-Cookie`, so a `Secure`
 * clear sent over plaintext is discarded exactly like the original was. Signing
 * out would appear to succeed and leave the session cookie in place.
 */
export function clearSessionCookie(
  response: CookieWriter,
  request: CookieRequest,
): void {
  response.setHeader("Set-Cookie", serialise("", 0, request));
}

import type { IncomingMessage } from "node:http";

/**
 * The resolved firm, carried on the request.
 *
 * A symbol rather than a string property, and read through an accessor rather
 * than directly: nothing else in the process can collide with it, nothing can
 * set it by assigning a plausible-looking field, and `requireFirmId` throws
 * rather than returning undefined — so a handler that runs without resolution
 * fails loudly instead of quietly treating "no firm" as a value.
 */
const FIRM_ID = Symbol("legal.firmId");

export interface TenantRequest extends IncomingMessage {
  [FIRM_ID]?: string;
}

export function setFirmId(request: TenantRequest, firmId: string): void {
  request[FIRM_ID] = firmId;
}

export function getFirmId(request: TenantRequest): string | undefined {
  return request[FIRM_ID];
}

/**
 * For code downstream of the middleware, where an unresolved request is a bug
 * in the wiring rather than a condition to handle.
 */
export function requireFirmId(request: TenantRequest): string {
  const firmId = getFirmId(request);

  if (!firmId) {
    throw new Error(
      "No firm resolved for this request. TenantMiddleware must run before " +
        "any handler that reaches tenant data.",
    );
  }

  return firmId;
}

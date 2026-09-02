import { ConflictException, NotFoundException } from "@nestjs/common";
import { requireSession } from "../auth/authenticated-request.js";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { requireFirmId } from "../tenant/tenant-request.js";
import {
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
  postgresErrorCode,
} from "./database-errors.js";

/**
 * Who is doing this, and from where.
 *
 * Assembled from the tenant middleware and the validated session — never from
 * the request body, so there is no field a caller could add to act in another
 * firm or as another person.
 */
export interface Actor {
  firmId: string;
  userId: string;
  ip: string | null;
}

export function actorOf(request: AuthenticatedRequest): Actor {
  return {
    firmId: requireFirmId(request),
    userId: requireSession(request).user.userId,
    ip: request.socket.remoteAddress ?? null,
  };
}

/**
 * Turns the two constraint violations a caller can actually cause into
 * responses. Shared by every write route, so the mapping cannot drift between
 * resources — which matters more than the few lines it saves, because a
 * foreign key that answers 404 on one route and 500 on another is a
 * distinguishability leak on the second.
 *
 * **Foreign key violation → 404.** The composite keys carry `firm_id`, so a
 * reference to another firm's row and a reference to a row that never existed
 * fail identically; 404 keeps them that way. For a representative the key also
 * carries `client_type`, so "that client is an individual" arrives here as the
 * same error and gets the same answer. The response deliberately does not say
 * which reference failed: naming it would confirm that the others resolved,
 * which for a cross-firm id is exactly the confirmation to withhold.
 *
 * **Unique violation → 409.** A case number or an identifier already used in
 * this firm. Unlike the references above, this tells the caller nothing they
 * could not learn by listing their own records.
 *
 * Anything else is returned unchanged and surfaces as a 500. A constraint
 * nobody anticipated should be fixed, not flattened into a 400 that blames the
 * caller.
 */
export function translateWriteError(error: unknown): unknown {
  const code = postgresErrorCode(error);

  if (code === PG_FOREIGN_KEY_VIOLATION) {
    return new NotFoundException();
  }

  if (code === PG_UNIQUE_VIOLATION) {
    return new ConflictException();
  }

  return error;
}

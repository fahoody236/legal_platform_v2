import {
  Inject,
  Injectable,
  NotFoundException,
  type NestMiddleware,
} from "@nestjs/common";
import { type Database, resolveFirmBySubdomain } from "@legal/db";
import { DATABASE } from "../database/database.module.js";
import { extractSubdomain } from "./subdomain.js";
import { tenantConfig } from "./tenant.config.js";
import { setFirmId, type TenantRequest } from "./tenant-request.js";

/**
 * Resolves every request to a firm before anything else runs.
 *
 * The firm comes from the Host header and from nowhere else — never a query
 * parameter, a body field, or a header a client can set for itself. That is the
 * whole point of identifying tenants by subdomain: the value that decides which
 * firm's data a request may reach is fixed by DNS and TLS rather than supplied
 * by the caller.
 *
 * Unknown subdomain, archived firm, apex domain, and malformed host all produce
 * the same 404 with the same body. A firm's existence is not a secret — the
 * hostname is public — but there is no reason for the responses to differ, and
 * uniformity means a future change cannot accidentally introduce a distinction.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async use(
    request: TenantRequest,
    _response: unknown,
    next: (error?: unknown) => void,
  ): Promise<void> {
    const host = request.headers.host;

    // In local development localhost carries no firm label, so the configured
    // subdomain stands in. It is still resolved through the same lookup: an
    // unknown value 404s exactly as it would in production.
    const subdomain =
      extractSubdomain(host, tenantConfig.platformDomain) ??
      tenantConfig.devFirmSubdomain;

    if (!subdomain) {
      throw new NotFoundException();
    }

    const firmId = await resolveFirmBySubdomain(this.db, subdomain);

    if (!firmId) {
      throw new NotFoundException();
    }

    setFirmId(request, firmId);
    next();
  }
}

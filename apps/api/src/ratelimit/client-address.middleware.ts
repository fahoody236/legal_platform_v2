import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import {
  resolveClientAddress,
  setClientAddress,
  type AddressedRequest,
} from "./client-address.js";
import { rateLimitConfig } from "./rate-limit.config.js";
import { refused } from "./rate-limit.guard.js";
import { RateLimitService } from "./rate-limit.service.js";

/**
 * First thing on every request: decide the client's address, then apply the
 * flood ceiling to it.
 *
 * Registered before the tenant middleware, so a refused request costs no
 * database call — the tenant lookup is one, and it runs for every request
 * that gets past here. /health is excluded, as it is from the tenant
 * middleware: it is the one route whose job is to answer under load.
 */
@Injectable()
export class ClientAddressMiddleware implements NestMiddleware {
  constructor(private readonly limiter: RateLimitService) {}

  async use(
    request: AddressedRequest,
    response: ServerResponse,
    next: (error?: unknown) => void,
  ): Promise<void> {
    const address = resolveClientAddress(
      request.socket.remoteAddress,
      request.headers["x-forwarded-for"],
      rateLimitConfig.trustedProxies,
    );

    setClientAddress(request, address);

    const decision = await this.limiter.consumeFlood(address);

    if (!decision.allowed) {
      next(refused(response, decision));
      return;
    }

    next();
  }
}

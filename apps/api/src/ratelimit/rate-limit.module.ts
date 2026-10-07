import {
  Global,
  Inject,
  Injectable,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { withTenant, type Database } from "@legal/db";
import { AuditService } from "../audit/audit.service.js";
import { DATABASE } from "../database/database.module.js";
import { ClientAddressMiddleware } from "./client-address.middleware.js";
import { MemoryRateLimitStore, RATE_LIMIT_STORE } from "./rate-limit-store.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import {
  REFUSAL_AUDIT,
  RateLimitService,
  type RefusalAudit,
  type RefusalRecord,
} from "./rate-limit.service.js";

/**
 * Writes a refusal to the firm's audit trail in a transaction opened for the
 * entry alone. Every other audit entry shares its action's transaction (see
 * AuditService); a refusal has no action, so this is the one place an entry
 * is its own transaction. The firm comes from the tenant middleware, which
 * has run by the time any refusal with a firm is possible.
 */
@Injectable()
class DatabaseRefusalAudit implements RefusalAudit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async record(refusal: RefusalRecord): Promise<void> {
    await withTenant(this.db, refusal.firmId, (tx) =>
      this.audit.record(tx, {
        action: refusal.action,
        resourceType: "rate_limit",
        resourceId: null,
        actorUserId: refusal.actorUserId,
        detail: refusal.detail,
        ip: refusal.ip,
      }),
    );
  }
}

/**
 * The limiter itself: store, service, and the address middleware. Global, so
 * the session guard can consume the unauthenticated rule without AuthModule
 * importing anything that would change guard order.
 *
 * The guard is deliberately not here — see RateLimitGuardModule.
 */
@Global()
@Module({
  providers: [
    { provide: RATE_LIMIT_STORE, useClass: MemoryRateLimitStore },
    { provide: REFUSAL_AUDIT, useClass: DatabaseRefusalAudit },
    RateLimitService,
    ClientAddressMiddleware,
  ],
  exports: [RateLimitService],
})
export class RateLimitModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(ClientAddressMiddleware)
      .exclude({ path: "api/health", method: RequestMethod.ALL })
      .forRoutes("*");
  }
}

/**
 * Registers the guard, and nothing else, so that where this module sits in
 * AppModule's import list is where the guard sits in the guard order: after
 * SessionGuard (AuthModule), before PermissionGuard (PermissionsModule).
 * Nest registers global guards as their providers resolve, and a module that
 * AuthModule imported would resolve before AuthModule's own providers.
 */
@Module({
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class RateLimitGuardModule {}

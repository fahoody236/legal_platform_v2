import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from "@nestjs/common";
import { TenantMiddleware } from "./tenant.middleware.js";

/**
 * Applies tenant resolution to everything, with one exclusion.
 *
 * `/api/health` is liveness for a load balancer, which reaches the service by an
 * internal address that has no firm subdomain. It touches no tenant data, so it
 * needs no firm — and it is the only route that will get that argument without
 * a much better reason.
 *
 * The path carries the global prefix set in main.ts. Middleware exclusions are
 * matched against the prefixed path, so `health` alone would silently stop
 * matching and every liveness probe would start demanding a resolved firm —
 * failing in the safe direction, but failing.
 *
 * Note the direction of the default: routes are covered unless excluded here,
 * so a new endpoint is tenant-resolved the moment it exists rather than when
 * someone remembers to add it.
 */
@Module({
  providers: [TenantMiddleware],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantMiddleware)
      .exclude({ path: "api/health", method: RequestMethod.ALL })
      .forRoutes("*");
  }
}

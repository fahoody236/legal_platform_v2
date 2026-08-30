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
 * `/health` is liveness for a load balancer, which reaches the service by an
 * internal address that has no firm subdomain. It touches no tenant data, so it
 * needs no firm — and it is the only route that will get that argument without
 * a much better reason.
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
      .exclude({ path: "health", method: RequestMethod.ALL })
      .forRoutes("*");
  }
}

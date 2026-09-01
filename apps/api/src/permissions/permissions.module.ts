import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PermissionGuard } from "./permission.guard.js";
import { PermissionsService } from "./permissions.service.js";

/**
 * Imported after AuthModule in AppModule, because global guards run in
 * registration order and PermissionGuard reads what SessionGuard attaches.
 *
 * TODO: boot-time route declaration check (docs/decisions/0004-permissions.md,
 * "Deny by default, mechanically", point 2).
 *
 * It should walk Nest's route table at `onApplicationBootstrap` and refuse to
 * start if any route declares neither `@RequirePermission(...)`, `@SessionOnly()`
 * nor `@Public()`, or declares more than one. PermissionGuard already denies an
 * undeclared route at request time, so the system is not unsafe without this —
 * but a 403 on a route that was meant to work is a bug someone finds later, in
 * an environment, by being confused. Refusing to boot moves that discovery to
 * the developer who wrote the handler.
 *
 * It should also assert that SessionGuard is registered before PermissionGuard,
 * since an inverted order would reject every authenticated caller on a gated
 * route: safe, but hard to diagnose from the symptom.
 *
 * Deferred because both halves need a route-table API that holds up. The
 * obvious sources do not: `ApplicationConfig` owns the authoritative guard
 * order but is constructed by NestFactory rather than provided, so it cannot be
 * injected; `DiscoveryService.getProviders()` does expose both guards, but in
 * module *scan* order, which was observed to differ from the *instantiation*
 * order that actually determines when each guard is registered — so an index
 * comparison over it would be a check that reports the wrong answer, which is
 * worse than no check. Settling that needs the guards instrumented at request
 * time to establish ground truth first.
 */
@Module({
  providers: [
    PermissionsService,
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [PermissionsService],
})
export class PermissionsModule {}

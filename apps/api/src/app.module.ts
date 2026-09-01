import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health.controller.js";
import { PermissionsModule } from "./permissions/permissions.module.js";
import { TenantModule } from "./tenant/tenant.module.js";

/**
 * Import order is significant. Nest registers global guards in the order the
 * providers declaring them are resolved, and PermissionGuard reads the session
 * SessionGuard attaches — so AuthModule must come before PermissionsModule.
 * Nothing enforces that yet; see the TODO in PermissionsModule.
 */
@Module({
  imports: [DatabaseModule, TenantModule, AuthModule, PermissionsModule],
  controllers: [HealthController],
})
export class AppModule {}

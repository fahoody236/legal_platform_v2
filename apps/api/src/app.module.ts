import { Module } from "@nestjs/common";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CasesModule } from "./cases/cases.module.js";
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
  imports: [
    DatabaseModule,
    AuditModule,
    TenantModule,
    AuthModule,
    PermissionsModule,
    CasesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

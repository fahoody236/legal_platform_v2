import { Module } from "@nestjs/common";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CasesModule } from "./cases/cases.module.js";
import { ClientsModule } from "./clients/clients.module.js";
import { DashboardModule } from "./dashboard/dashboard.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health.controller.js";
import { PermissionsModule } from "./permissions/permissions.module.js";
import { SearchModule } from "./search/search.module.js";
import { TasksModule } from "./tasks/tasks.module.js";
import { TenantModule } from "./tenant/tenant.module.js";
import { UsersModule } from "./users/users.module.js";

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
    ClientsModule,
    UsersModule,
    TasksModule,
    SearchModule,
    DashboardModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

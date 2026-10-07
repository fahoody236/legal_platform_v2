import { Module } from "@nestjs/common";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CasesModule } from "./cases/cases.module.js";
import { ClientsModule } from "./clients/clients.module.js";
import { DashboardModule } from "./dashboard/dashboard.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { DocumentsModule } from "./documents/documents.module.js";
import { HearingsModule } from "./hearings/hearings.module.js";
import { HealthController } from "./health.controller.js";
import { PermissionsModule } from "./permissions/permissions.module.js";
import {
  RateLimitGuardModule,
  RateLimitModule,
} from "./ratelimit/rate-limit.module.js";
import { RolesModule } from "./roles/roles.module.js";
import { SearchModule } from "./search/search.module.js";
import { TasksModule } from "./tasks/tasks.module.js";
import { TenantModule } from "./tenant/tenant.module.js";
import { UsersModule } from "./users/users.module.js";

/**
 * Import order is significant, twice over.
 *
 * Guards: Nest registers global guards in the order the providers declaring
 * them are resolved. PermissionGuard reads the session SessionGuard attaches,
 * and RateLimitGuard keys by it — so AuthModule, then RateLimitGuardModule,
 * then PermissionsModule. Nothing enforces that yet; see the TODO in
 * PermissionsModule and the deferred check in ADR 0004.
 *
 * Middleware: applied in module order too. RateLimitModule's address
 * middleware must precede TenantModule's, so that a request refused by the
 * flood ceiling never reaches the tenant lookup, which is a database call.
 */
@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    RateLimitModule,
    TenantModule,
    AuthModule,
    RateLimitGuardModule,
    PermissionsModule,
    CasesModule,
    ClientsModule,
    UsersModule,
    TasksModule,
    HearingsModule,
    DocumentsModule,
    SearchModule,
    DashboardModule,
    RolesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

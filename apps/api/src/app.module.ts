import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health.controller.js";
import { TenantModule } from "./tenant/tenant.module.js";

@Module({
  imports: [DatabaseModule, TenantModule],
  controllers: [HealthController],
})
export class AppModule {}

import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service.js";

/**
 * Global, because almost everything that will ever be written in this
 * application has something to record, and a service that is awkward to reach
 * is a service someone works around.
 *
 * It holds no connection of its own — `record` takes the caller's transaction —
 * so being global costs nothing and grants nothing.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}

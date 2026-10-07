import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { SessionGuard } from "./session.guard.js";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    // Global, so authentication is the default for every route in the
    // application rather than something each one opts into.
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}

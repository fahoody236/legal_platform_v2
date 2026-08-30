import { Module } from "@nestjs/common";
import { AuthService } from "./auth.service.js";

/** Service layer only — no controller, no route, nothing reachable over HTTP yet. */
@Module({
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}

import { Module } from "@nestjs/common";
import { HearingsController } from "./hearings.controller.js";
import { HearingsService } from "./hearings.service.js";

@Module({
  controllers: [HearingsController],
  providers: [HearingsService],
})
export class HearingsModule {}

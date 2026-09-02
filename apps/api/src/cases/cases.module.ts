import { Module } from "@nestjs/common";
import { CasesController } from "./cases.controller.js";
import { CasesService } from "./cases.service.js";

@Module({
  controllers: [CasesController],
  providers: [CasesService],
})
export class CasesModule {}

import { Module } from "@nestjs/common";
import {
  ClientsController,
  RepresentativesController,
} from "./clients.controller.js";
import { ClientsService } from "./clients.service.js";

@Module({
  controllers: [ClientsController, RepresentativesController],
  providers: [ClientsService],
})
export class ClientsModule {}

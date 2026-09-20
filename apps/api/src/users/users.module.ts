import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module.js";
import { InvitationsController } from "./invitations.controller.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

@Module({
  imports: [MailModule],
  controllers: [UsersController, InvitationsController],
  providers: [UsersService],
})
export class UsersModule {}

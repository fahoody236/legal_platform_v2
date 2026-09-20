import { Module } from "@nestjs/common";
import { ConsoleMailer, NullMailer } from "./console-mailer.js";
import { mailConfig } from "./mail.config.js";
import { MAILER } from "./mailer.js";

@Module({
  providers: [
    {
      provide: MAILER,
      useFactory: () =>
        mailConfig.transport === "console"
          ? new ConsoleMailer()
          : new NullMailer(),
    },
  ],
  exports: [MAILER],
})
export class MailModule {}

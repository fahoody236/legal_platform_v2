import type { Mailer, MailMessage } from "./mailer.js";

/**
 * Prints the message instead of sending it. For development only: the
 * invitation link is a secret, and a process log is the wrong place for one.
 * mail.config.ts refuses this transport in production.
 */
export class ConsoleMailer implements Mailer {
  async send(message: MailMessage): Promise<{ delivered: boolean }> {
    console.log(
      `\n──── mail (not sent) ────\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n─────────────────────────\n`,
    );
    return { delivered: false };
  }
}

/** Sends nothing and says so. For a deployment with no relay configured. */
export class NullMailer implements Mailer {
  async send(): Promise<{ delivered: boolean }> {
    return { delivered: false };
  }
}

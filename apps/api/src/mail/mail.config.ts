/**
 * Evaluated when the module graph loads, so a misconfiguration is a startup
 * failure rather than a surprise on the first invitation.
 */

const isProduction = process.env["NODE_ENV"] === "production";

const TRANSPORTS = ["console", "none"] as const;
export type MailTransport = (typeof TRANSPORTS)[number];

const raw = process.env["MAIL_TRANSPORT"];

/**
 * Development defaults to printing; production must choose. `console` is
 * refused there outright: it writes invitation links — each one the power to
 * set a colleague's password — into whatever collects stdout.
 *
 * `none` is allowed in production precisely because no real transport exists
 * yet. It is not silent: every invitation response says the email was not
 * sent, and the interface tells the administrator to pass the link on.
 */
function resolve(): MailTransport {
  if (raw === undefined) {
    if (isProduction) {
      throw new Error(
        'MAIL_TRANSPORT must be set in production. Use "none" until an ' +
          "in-Kingdom mail relay is configured; see apps/api/src/mail/mailer.ts.",
      );
    }
    return "console";
  }

  if (!(TRANSPORTS as readonly string[]).includes(raw)) {
    throw new Error(
      `MAIL_TRANSPORT="${raw}" is not a transport. Known: ${TRANSPORTS.join(", ")}.`,
    );
  }

  if (raw === "console" && isProduction) {
    throw new Error(
      "MAIL_TRANSPORT=console is refused in production: it prints invitation " +
        "links to the process log.",
    );
  }

  return raw as MailTransport;
}

export const mailConfig = { transport: resolve() } as const;

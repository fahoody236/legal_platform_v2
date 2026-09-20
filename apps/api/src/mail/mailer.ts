/**
 * Outbound email, behind an interface, because the transport is not decided.
 *
 * ── Why the transport is a decision and not a library ────────────────────────
 *
 * An invitation carries no client data: an address, a name, the firm's name,
 * a link. But the address and the firm membership are staff personal data,
 * and a mail provider outside the Kingdom processing them is a cross-border
 * transfer under the PDPL that needs a basis. And the next message through
 * this channel — "you were assigned case 2026/004 for such-and-such client" —
 * will carry client data, at which point the residency rule that governs the
 * database governs this too. Held to that rule, the credible transports are an
 * SMTP relay run on the in-Kingdom infrastructure, or the email service of
 * whichever Saudi-region cloud hosts the application. That is a hosting
 * decision this repository has not made, so no transport is wired here yet.
 *
 * What exists: this interface, and two transports that do not send —
 * `console` for development and `none` for a deployment that has no relay
 * yet. Both report `delivered: false`, and the invitation flow is built so
 * that is survivable: the administrator sees the link and passes it on.
 *
 * A message's text is Arabic-first and plain text. HTML mail is a later
 * decision, and one that needs the same residency thought about every image
 * it would load.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  /**
   * Resolves `delivered: false` rather than throwing when the transport cannot
   * send: an invitation whose email fails is still an invitation, and the
   * caller needs to know to show the link, not to roll back.
   */
  send(message: MailMessage): Promise<{ delivered: boolean }>;
}

export const MAILER = Symbol("legal.mailer");

import { Inject, Injectable } from "@nestjs/common";
import {
  acceptInvitation,
  createInvitation,
  createUser,
  disableUser,
  enableUser,
  findOpenInvitationByTokenHash,
  findUserById,
  listLatestInvitations,
  listUsers,
  revokeAllSessionsForUser,
  revokePendingInvitations,
  updateUser,
  upsertCredential,
  withTenant,
  type Database,
  type LatestInvitation,
  type TenantTransaction,
  type User,
} from "@legal/db";
import { AuditService } from "../audit/audit.service.js";
import { hashPassword } from "../auth/password.js";
import { hashOpaqueToken, issueOpaqueToken } from "../auth/session-token.js";
import type { Actor } from "../common/request-context.js";
import { DATABASE } from "../database/database.module.js";
import { MAILER, type Mailer } from "../mail/mailer.js";
import type { CreateUserInput, UpdateUserInput } from "./dto.js";

/** A week. Long enough for a holiday, short enough that a lost link dies. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A user as the firm's own directory sees them.
 *
 * A deliberately narrow projection of the `users` row. It carries what an
 * interface needs to name a colleague and nothing else — no `created_at`, no
 * `firm_id`, and nothing that could later be added to the table without someone
 * choosing to expose it here. The table is where credentials and session
 * ownership hang off, so "return the row" is the wrong default for it.
 */
export interface DirectoryUser {
  id: string;
  fullName: string;
  fullNameAr: string | null;
  email: string;
  /** Null while active. Carries when, not just whether — both are useful. */
  disabledAt: string | null;
}

/**
 * What an administrator gets back when a link is issued.
 *
 * `link` is the only time the token leaves the server in the clear. It is not
 * retrievable afterwards — only the hash is kept — so an administrator who
 * needs it again resends, which issues a new one and revokes this. That
 * single exposure is recorded in the audit entry as `linkShown`, because an
 * administrator holding the link can accept it themselves; see the note on
 * `resendInvitation`.
 */
export interface IssuedInvitation {
  link: string;
  expiresAt: string;
  /** False for every transport that exists today. See mail/mailer.ts. */
  emailSent: boolean;
}

export interface InvitationSummary {
  userId: string;
  status: LatestInvitation["status"];
  createdAt: string;
  expiresAt: string;
}

/** Who a presented token is for, shown before a password is asked for. */
export interface InvitationPreview {
  email: string;
  fullName: string;
  fullNameAr: string | null;
  expiresAt: string;
}

function toDirectoryUser(row: User): DirectoryUser {
  return {
    id: row.id,
    fullName: row.fullName,
    fullNameAr: row.fullNameAr,
    email: row.email,
    disabledAt: row.disabledAt?.toISOString() ?? null,
  };
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: Actor,
    options: { includeDisabled: boolean },
  ): Promise<DirectoryUser[]> {
    const rows = await withTenant(this.db, actor.firmId, (tx) =>
      listUsers(tx, { includeDisabled: options.includeDisabled }),
    );

    return rows.map(toDirectoryUser);
  }

  /**
   * The user and their first invitation, in one transaction. Roles are not
   * here — see createUserSchema for why — so a new person holds nothing until
   * someone with `roles.manage` says otherwise.
   *
   * A duplicate address surfaces as the unique violation on
   * `users_firm_id_lower_email_key` — case-insensitive, per firm — and the
   * controller answers 409. That includes an address belonging to a disabled
   * colleague: the record exists, and the right action is to enable it, not
   * to create a second person with the same identity.
   */
  async create(
    actor: Actor,
    origin: string,
    input: CreateUserInput,
  ): Promise<{ user: DirectoryUser; invitation: IssuedInvitation }> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const created = await createUser(tx, {
        email: input.email,
        fullName: input.fullName,
        fullNameAr: input.fullNameAr,
      });

      await this.audit.record(tx, {
        action: "users.created",
        resourceType: "user",
        resourceId: created.id,
        actorUserId: actor.userId,
        detail: { email: created.email.toLowerCase() },
        ip: actor.ip,
      });

      const invitation = await this.issue(
        tx,
        actor,
        origin,
        created,
        "invitations.created",
      );

      return { user: toDirectoryUser(created), invitation };
    });
  }

  async update(
    actor: Actor,
    id: string,
    input: UpdateUserInput,
  ): Promise<DirectoryUser | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const before = await findUserById(tx, id);

      if (!before) {
        return undefined;
      }

      const updated = await updateUser(tx, id, input);

      if (!updated) {
        return undefined;
      }

      await this.audit.record(tx, {
        action: "users.updated",
        resourceType: "user",
        resourceId: id,
        actorUserId: actor.userId,
        detail: {
          changed: Object.keys(input).sort(),
          ...(before.fullName === updated.fullName
            ? {}
            : { fullName: { from: before.fullName, to: updated.fullName } }),
          ...(before.fullNameAr === updated.fullNameAr
            ? {}
            : {
                fullNameAr: { from: before.fullNameAr, to: updated.fullNameAr },
              }),
          self: id === actor.userId,
        },
        ip: actor.ip,
      });

      return toDirectoryUser(updated);
    });
  }

  /**
   * Revokes access now, not at the next sign-in: every open session is ended
   * and every pending invitation is revoked in the same transaction, so a
   * disabled colleague's browser tab and their unread invitation email both
   * stop working at the same moment their record does.
   *
   * If they were the only administrator, the trigger refuses the commit
   * (SQLSTATE LA001) and none of this — sessions, invitations, the audit
   * entry — is written. The controller answers 409 with the code the
   * interface already knows from the role screens.
   *
   * Disabling yourself is allowed, subject to the same rule. It is a strange
   * thing to want, and the interface asks twice, but a person leaving the firm
   * closing their own account on the way out is not a mistake to forbid.
   */
  async disable(actor: Actor, id: string): Promise<DirectoryUser | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const before = await findUserById(tx, id);

      if (!before) {
        return undefined;
      }

      const disabled = await disableUser(tx, id);

      if (!disabled) {
        return undefined;
      }

      const sessionsRevoked = await revokeAllSessionsForUser(tx, id);
      const invitationsRevoked = await revokePendingInvitations(tx, id);

      await this.audit.record(tx, {
        action: "users.disabled",
        resourceType: "user",
        resourceId: id,
        actorUserId: actor.userId,
        detail: {
          alreadyDisabled: before.disabledAt !== null,
          sessionsRevoked,
          invitationsRevoked,
          self: id === actor.userId,
        },
        ip: actor.ip,
      });

      return toDirectoryUser(disabled);
    });
  }

  /**
   * Restores the record. Sessions stay revoked and invitations stay revoked —
   * the person signs in again with the password they had, or an
   * administrator resends an invitation if they never chose one.
   */
  async enable(actor: Actor, id: string): Promise<DirectoryUser | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const before = await findUserById(tx, id);

      if (!before) {
        return undefined;
      }

      const enabled = await enableUser(tx, id);

      if (!enabled) {
        return undefined;
      }

      await this.audit.record(tx, {
        action: "users.enabled",
        resourceType: "user",
        resourceId: id,
        actorUserId: actor.userId,
        detail: { alreadyEnabled: before.disabledAt === null },
        ip: actor.ip,
      });

      return toDirectoryUser(enabled);
    });
  }

  /**
   * A fresh link, and every earlier open link dead.
   *
   * ── The link is shown to the administrator ───────────────────────────────
   *
   * Deliberately, and it is a trade-off worth stating. Whoever holds the link
   * can choose the password, so an administrator who sees it could accept it
   * themselves and act as the new person — an attribution problem, since the
   * audit trail would name the new user. Two things make that survivable:
   * the entry below records that the link was shown and to whom, the
   * acceptance records the address it came from, and a colleague who finds
   * their link already used will say so. The alternative — never showing it —
   * means a firm whose email is not working cannot bring anyone in at all,
   * and until a mail transport exists that is every firm.
   */
  async resendInvitation(
    actor: Actor,
    origin: string,
    userId: string,
  ): Promise<
    | { outcome: "issued"; invitation: IssuedInvitation }
    | { outcome: "not_found" }
    | { outcome: "disabled" }
  > {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const user = await findUserById(tx, userId);

      if (!user) {
        return { outcome: "not_found" };
      }

      if (user.disabledAt !== null) {
        return { outcome: "disabled" };
      }

      const invitation = await this.issue(
        tx,
        actor,
        origin,
        user,
        "invitations.resent",
      );

      return { outcome: "issued", invitation };
    });
  }

  private async issue(
    tx: TenantTransaction,
    actor: Actor,
    origin: string,
    user: User,
    action: "invitations.created" | "invitations.resent",
  ): Promise<IssuedInvitation> {
    const revoked = await revokePendingInvitations(tx, user.id);

    const { token, tokenHash } = issueOpaqueToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    const row = await createInvitation(tx, {
      userId: user.id,
      invitedByUserId: actor.userId,
      tokenHash,
      expiresAt,
    });

    const link = `${origin}/invite/${token}`;

    // Inside the transaction: a message about a link that then fails to commit
    // would be a link to nothing. The mailer resolves rather than throws, so a
    // transport failure cannot roll the invitation back — the link is still
    // shown, which is the fallback the whole flow is built around.
    const { delivered } = await this.mailer.send({
      to: user.email,
      subject: "دعوة للانضمام إلى المنصة القانونية",
      text:
        `مرحباً ${user.fullNameAr ?? user.fullName}،\n\n` +
        `أُنشئ لك حساب على المنصة القانونية. لتعيين كلمة المرور وتسجيل الدخول، افتح الرابط التالي:\n\n` +
        `${link}\n\n` +
        `ينتهي هذا الرابط خلال سبعة أيام. إن لم تكن تتوقع هذه الدعوة فتجاهل الرسالة.\n`,
    });

    await this.audit.record(tx, {
      action,
      resourceType: "invitation",
      resourceId: row.id,
      actorUserId: actor.userId,
      detail: {
        userId: user.id,
        expiresAt: expiresAt.toISOString(),
        revokedPending: revoked,
        emailDelivered: delivered,
        linkShown: true,
      },
      ip: actor.ip,
    });

    return { link, expiresAt: expiresAt.toISOString(), emailSent: delivered };
  }

  async listInvitations(actor: Actor): Promise<InvitationSummary[]> {
    const rows = await withTenant(this.db, actor.firmId, (tx) =>
      listLatestInvitations(tx),
    );

    return rows.map((row) => ({
      userId: row.userId,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }));
  }

  /**
   * Who a token is for, so the acceptance screen can greet the person and say
   * plainly when the link is dead — before asking for a password. `firmId`
   * comes from the Host, as for sign-in: the token is looked up in that
   * tenant's context and nowhere else.
   */
  async lookupInvitation(
    firmId: string,
    token: string,
  ): Promise<InvitationPreview | undefined> {
    const tokenHash = hashOpaqueToken(token);

    const open = await withTenant(this.db, firmId, (tx) =>
      findOpenInvitationByTokenHash(tx, tokenHash),
    );

    if (!open) {
      return undefined;
    }

    return {
      email: open.email,
      fullName: open.fullName,
      fullNameAr: open.fullNameAr,
      expiresAt: open.expiresAt.toISOString(),
    };
  }

  /**
   * Sets the password and closes the link.
   *
   * The token is checked before the password is hashed, so a request with a
   * dead token costs one indexed read and not an Argon2 run — the public
   * route should not be a way to make the server do expensive work. It is
   * checked again inside the write transaction, because between the two the
   * link could have been revoked or accepted from another tab.
   *
   * The audit entry is filed under the new user as actor: it is the first
   * thing they did, and the address it came from is the one fact that can
   * later distinguish them accepting it from someone else doing so.
   */
  async acceptInvitation(
    firmId: string,
    token: string,
    password: string,
    ip: string | null,
  ): Promise<boolean> {
    const tokenHash = hashOpaqueToken(token);

    const preview = await withTenant(this.db, firmId, (tx) =>
      findOpenInvitationByTokenHash(tx, tokenHash),
    );

    if (!preview) {
      return false;
    }

    const passwordHash = await hashPassword(password);

    return withTenant(this.db, firmId, async (tx) => {
      const open = await findOpenInvitationByTokenHash(tx, tokenHash);

      if (!open) {
        return false;
      }

      await upsertCredential(tx, { userId: open.userId, passwordHash });
      await acceptInvitation(tx, open.invitationId);

      await this.audit.record(tx, {
        action: "invitations.accepted",
        resourceType: "invitation",
        resourceId: open.invitationId,
        actorUserId: open.userId,
        ip,
      });

      return true;
    });
  }
}

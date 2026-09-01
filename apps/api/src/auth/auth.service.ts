import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  clearFailedAttempts,
  createSession,
  findActiveSessionByTokenHash,
  findCredentialByEmail,
  recordFailedAttempt,
  revokeSession,
  touchSession,
  withTenant,
  type Database,
} from "@legal/db";
import { AuditService } from "../audit/audit.service.js";
import { DATABASE } from "../database/database.module.js";
import { dummyPasswordHash, verifyPassword } from "./password.js";
import { hashSessionToken, issueSessionToken } from "./session-token.js";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface AuthenticatedUser {
  userId: string;
  email: string;
  fullName: string;
}

export interface AuthenticatedSession {
  sessionId: string;
  user: AuthenticatedUser;
}

export type LoginResult =
  | {
      outcome: "authenticated";
      /** Plaintext, returned exactly once. Only its SHA-256 is stored. */
      token: string;
      expiresAt: Date;
      user: AuthenticatedUser;
    }
  | { outcome: "rejected" };

/**
 * One frozen object for every failure. Unknown address, wrong password, locked
 * credential, disabled user — all return this same value, so no caller can
 * accidentally branch on a distinction that should not exist, and no future
 * edit can add a `reason` field to one path and not another.
 */
const REJECTED: LoginResult = Object.freeze({ outcome: "rejected" as const });

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * Computes the dummy hash at startup so the first unknown-user sign-in is not
   * measurably slower than the rest.
   */
  async onModuleInit(): Promise<void> {
    await dummyPasswordHash();
  }

  /**
   * `firmId` comes from the tenant middleware — from the Host header, never
   * from the request body. A caller cannot name the firm it wants to
   * authenticate against.
   *
   * Every path through this method performs exactly one Argon2 verification.
   * That is deliberate and load-bearing; see password.ts for why an early
   * return on "no such user" would turn this into a user-enumeration oracle.
   *
   * Every path also writes exactly one audit entry, which leaves the timing
   * profile as it was: the unknown-address path previously wrote nothing and
   * now writes one row, the wrong-password path previously wrote one and now
   * writes two, so the difference between them is the same single write it
   * always was — the ~1ms asymmetry noted in password.ts, against a ~22ms
   * baseline.
   *
   * The entries carry a `reason` the response does not. That is not a
   * contradiction of the frozen `REJECTED` above: what must be indistinguishable
   * is what the *caller* learns. A firm investigating its own sign-in failures
   * needs to tell a locked account from a mistyped address, and the audit trail
   * is where that distinction is safe to record.
   */
  async login(
    firmId: string,
    email: string,
    password: string,
    ip: string | null,
  ): Promise<LoginResult> {
    return withTenant(this.db, firmId, async (tx) => {
      const reject = async (
        reason: string,
        actorUserId: string | null,
      ): Promise<LoginResult> => {
        await this.audit.record(tx, {
          action: "auth.login.failed",
          resourceType: "session",
          actorUserId,
          // The submitted address, lowercased to match how it is looked up. It
          // was offered to this firm as an identifier, so it is this firm's to
          // see. The password is not here and must never be: an audit trail is
          // long-lived and disclosable, which is the worst possible home for a
          // credential someone typed into the wrong field.
          detail: { email: email.toLowerCase(), reason },
          ip,
        });

        return REJECTED;
      };

      const credential = await findCredentialByEmail(tx, email);

      if (!credential) {
        await verifyPassword(await dummyPasswordHash(), password);
        return reject("unknown_email", null);
      }

      // A locked or disabled account still pays for a verification. Skipping it
      // here would leak account state through timing just as surely as skipping
      // it for an unknown address leaks existence.
      const locked =
        credential.lockedUntil !== null && credential.lockedUntil > new Date();

      if (locked || credential.userDisabledAt !== null) {
        await verifyPassword(await dummyPasswordHash(), password);
        return reject(
          locked ? "locked" : "user_disabled",
          credential.userId,
        );
      }

      const valid = await verifyPassword(credential.passwordHash, password);

      if (!valid) {
        await recordFailedAttempt(tx, credential.credentialId, {
          maxAttempts: MAX_FAILED_ATTEMPTS,
          lockMinutes: LOCK_MINUTES,
        });
        return reject("wrong_password", credential.userId);
      }

      await clearFailedAttempts(tx, credential.credentialId);

      const { token, tokenHash } = issueSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

      const sessionId = await createSession(tx, {
        userId: credential.userId,
        tokenHash,
        expiresAt,
      });

      // Inside the same transaction as the session insert, so a session cannot
      // exist unrecorded and a record cannot describe a session that does not.
      await this.audit.record(tx, {
        action: "auth.login.succeeded",
        resourceType: "session",
        resourceId: sessionId,
        actorUserId: credential.userId,
        ip,
      });

      return {
        outcome: "authenticated",
        token,
        expiresAt,
        user: {
          userId: credential.userId,
          email: credential.email,
          fullName: credential.fullName,
        },
      };
    });
  }

  /**
   * Resolves a bearer token to the user it authenticates, or null.
   *
   * Scoped to `firmId` like everything else, which means a token issued by one
   * firm is inert on another firm's subdomain — the row exists but is not
   * visible in that tenant context.
   *
   * No timing equalisation here, and none is needed: the token is 256 random
   * bits, so there is no candidate set for an attacker to narrow, and the
   * lookup is a single indexed equality either way.
   */
  async validateSession(
    firmId: string,
    token: string,
  ): Promise<AuthenticatedSession | null> {
    const tokenHash = hashSessionToken(token);

    return withTenant(this.db, firmId, async (tx) => {
      const session = await findActiveSessionByTokenHash(tx, tokenHash);

      if (!session) {
        return null;
      }

      await touchSession(tx, session.sessionId);

      return {
        sessionId: session.sessionId,
        user: {
          userId: session.userId,
          email: session.email,
          fullName: session.fullName,
        },
      };
    });
  }

  /**
   * Ends one session. Idempotent, and silent about whether the session existed —
   * the caller is signing out either way, and there is nothing useful to tell
   * them about a token that was already dead.
   *
   * The revocation and its entry share a transaction, so a session cannot be
   * revoked without the trail saying who did it and when. That pairing is what
   * makes a session's lifetime — created here, ended here — reconstructible
   * from the log alone.
   */
  async logout(
    firmId: string,
    sessionId: string,
    actorUserId: string,
    ip: string | null,
  ): Promise<void> {
    await withTenant(this.db, firmId, async (tx) => {
      await revokeSession(tx, sessionId);

      await this.audit.record(tx, {
        action: "auth.logout",
        resourceType: "session",
        resourceId: sessionId,
        actorUserId,
        ip,
      });
    });
  }
}

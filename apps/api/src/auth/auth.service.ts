import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  clearFailedAttempts,
  createSession,
  findActiveSessionByTokenHash,
  findCredentialByEmail,
  recordFailedAttempt,
  touchSession,
  withTenant,
  type Database,
} from "@legal/db";
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
  constructor(@Inject(DATABASE) private readonly db: Database) {}

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
   */
  async login(
    firmId: string,
    email: string,
    password: string,
  ): Promise<LoginResult> {
    return withTenant(this.db, firmId, async (tx) => {
      const credential = await findCredentialByEmail(tx, email);

      if (!credential) {
        await verifyPassword(await dummyPasswordHash(), password);
        return REJECTED;
      }

      // A locked or disabled account still pays for a verification. Skipping it
      // here would leak account state through timing just as surely as skipping
      // it for an unknown address leaks existence.
      const locked =
        credential.lockedUntil !== null && credential.lockedUntil > new Date();

      if (locked || credential.userDisabledAt !== null) {
        await verifyPassword(await dummyPasswordHash(), password);
        return REJECTED;
      }

      const valid = await verifyPassword(credential.passwordHash, password);

      if (!valid) {
        await recordFailedAttempt(tx, credential.credentialId, {
          maxAttempts: MAX_FAILED_ATTEMPTS,
          lockMinutes: LOCK_MINUTES,
        });
        return REJECTED;
      }

      await clearFailedAttempts(tx, credential.credentialId);

      const { token, tokenHash } = issueSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

      await createSession(tx, {
        userId: credential.userId,
        tokenHash,
        expiresAt,
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
  ): Promise<AuthenticatedUser | null> {
    const tokenHash = hashSessionToken(token);

    return withTenant(this.db, firmId, async (tx) => {
      const session = await findActiveSessionByTokenHash(tx, tokenHash);

      if (!session) {
        return null;
      }

      await touchSession(tx, session.sessionId);

      return {
        userId: session.userId,
        email: session.email,
        fullName: session.fullName,
      };
    });
  }
}

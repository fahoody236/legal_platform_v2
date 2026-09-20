import { createHash, randomBytes } from "node:crypto";

/**
 * 256 bits from the OS entropy source. Long enough that guessing is not a
 * threat model, which is also why the stored digest is a fast hash rather than
 * a KDF — see the note on sessions.token_hash in the schema.
 */
const TOKEN_BYTES = 32;

export interface IssuedToken {
  /** Returned to the caller once. Never stored, never logged. */
  token: string;
  /** The only form that reaches the database. */
  tokenHash: string;
}

export function issueSessionToken(): IssuedToken {
  return issueOpaqueToken();
}

export function hashSessionToken(token: string): string {
  return hashOpaqueToken(token);
}

/**
 * The same construction for any bearer secret that is long, random and
 * stored only as a digest — sessions, and now invitations. One place, so the
 * two cannot drift to different lengths or different hashes.
 */
export function issueOpaqueToken(): IssuedToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashOpaqueToken(token) };
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

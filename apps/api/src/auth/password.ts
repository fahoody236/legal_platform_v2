import { randomBytes } from "node:crypto";
import argon2 from "argon2";

/**
 * Argon2id at the OWASP baseline: 19 MiB of memory, two passes, one lane.
 *
 * Memory-hard by design. The cost is not incidental — it is the entire defence,
 * because passwords are low-entropy and an attacker holding the hashes will try
 * billions of candidates. Raising memoryCost is what keeps that expensive on
 * hardware we do not control.
 *
 * These parameters are encoded into every hash produced, so changing them later
 * does not invalidate existing hashes: old ones keep verifying with their own
 * parameters, and are re-hashed on the next successful sign-in.
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

/**
 * Never throws. A malformed or truncated stored hash makes `argon2.verify`
 * raise, and an exception escaping here would distinguish "corrupt record" from
 * "wrong password" by response shape — the exact class of signal the rest of
 * this file exists to suppress.
 */
export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;

/**
 * A hash that no password will ever match, verified against when the account
 * does not exist so that the work — and therefore the elapsed time — is the
 * same as a real verification.
 *
 * ── Why this is necessary ────────────────────────────────────────────────────
 *
 * Argon2 is deliberately slow: a verification here costs roughly 50–100 ms. The
 * database lookup that precedes it costs about one. So a login that skips the
 * hash when no user is found answers in ~2 ms, while a login with a real user
 * and a wrong password answers in ~80 ms.
 *
 * That difference is not subtle. It is a factor of forty, measurable across a
 * network in a handful of samples, and it converts the login endpoint into a
 * user-enumeration oracle: submit an address, time the response, learn whether
 * that person has an account at this firm. Repeat down a list.
 *
 * Which matters more here than in most products. The threat model's first
 * adversary is a rival firm's employee after the client list and staff roster,
 * and firm membership is exactly what this oracle discloses — before any
 * password is guessed, without a single failed sign-in appearing in an audit
 * trail, because nobody ever authenticates. It also feeds the next step:
 * confirmed addresses are what password spraying and targeted phishing need.
 *
 * Returning an identical error body is not enough on its own. The response says
 * nothing; the clock says everything.
 *
 * ── Why a real hash, precomputed ─────────────────────────────────────────────
 *
 * The dummy must be a genuine Argon2id hash carrying these same parameters,
 * because `verify` reads the cost parameters out of the encoded hash string. A
 * dummy with a lower memoryCost would verify faster than a real one and
 * reintroduce the very gap it was meant to close, just narrower.
 *
 * It is computed once, at startup, rather than per call. Hashing a throwaway
 * value on each unknown-user request would make that path cost *two* hashes
 * instead of one — the same signal again, pointing the other way.
 *
 * It derives from 32 random bytes that are never stored or shown, so no input
 * can match it, and it differs on every process start.
 */
export function dummyPasswordHash(): Promise<string> {
  dummy ??= argon2.hash(randomBytes(32).toString("hex"), OPTIONS);
  return dummy;
}

/**
 * PostgreSQL SQLSTATE codes this application translates into HTTP responses.
 *
 * Codes rather than message text. The messages are localised, name constraints,
 * and change between server versions; the codes are part of the wire protocol
 * and do not.
 */
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_FOREIGN_KEY_VIOLATION = "23503";
export const PG_CHECK_VIOLATION = "23514";

/**
 * Digs the SQLSTATE code out of whatever the driver threw.
 *
 * Drizzle wraps driver errors, so the `pg` error carrying `.code` is usually one
 * or two `cause` links down rather than the object in hand — and how deep it
 * sits is an implementation detail of a library, not something to hard-code.
 * Walking the chain means a Drizzle upgrade that adds or removes a wrapper does
 * not silently turn every constraint violation into a 500.
 *
 * The depth limit guards against a cyclic `cause`, which is rare but is an
 * infinite loop rather than a wrong answer.
 */
export function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }

    const code: unknown = (current as { code?: unknown }).code;

    if (typeof code === "string") {
      return code;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}

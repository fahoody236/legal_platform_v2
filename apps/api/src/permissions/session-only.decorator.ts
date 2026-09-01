import { SetMetadata } from "@nestjs/common";

export const IS_SESSION_ONLY = "auth:session-only";

/**
 * Declares that a signed-in session is the whole requirement: no permission
 * applies, and none is missing.
 *
 * This exists because "requires a permission" and "requires nothing" do not
 * cover the routes that are about the session itself. `GET /auth/me` returns
 * who the caller already is, and `POST /auth/logout` ends the caller's own
 * session. Neither reads firm data, and neither can be gated: a permission that
 * every user must hold to see their own name is a permission a firm could
 * accidentally remove, locking people out of the interface without denying them
 * anything. The session *is* the authorisation, because the resource is the
 * session.
 *
 * It is not an escape hatch for routes that were awkward to gate. Any route
 * that reads or writes firm data — even the caller's own records — takes a
 * permission. The test is whether a firm administrator could sensibly want to
 * withhold it from one of their users. For "who am I", they could not.
 *
 * Being a separate declaration rather than the absence of one is the whole
 * point: it appears in review as a deliberate sentence, and the boot check
 * counts it, so nothing reaches production by having been forgotten.
 */
export const SessionOnly = () => SetMetadata(IS_SESSION_ONLY, true);

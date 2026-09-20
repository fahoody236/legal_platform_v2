import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "auth:public";

/**
 * Marks a route as reachable without a session.
 *
 * The guard is applied globally, so this decorator is the only way out — and it
 * has to be written on the route itself, in the file under review, rather than
 * in a path list somewhere else that no one reads when adding an endpoint.
 * Every use is a deliberate statement that this route exposes nothing tenant-
 * specific.
 *
 * Four in the application: sign-in, which cannot require a session in order
 * to create one; liveness, which touches no data; and the two invitation
 * routes, where the token is the credential and a session is what accepting
 * it makes possible.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

import { SetMetadata } from "@nestjs/common";
import type { PermissionKey } from "@legal/db";

export const REQUIRED_PERMISSION = "auth:permission";

/**
 * Declares the permission a route requires.
 *
 * One permission per route, not a list. A handler that needed two would be
 * doing two things, and the honest fix is two routes — an "or" would make the
 * effective rule harder to read than the code granting it, and an "and" invites
 * a set that nobody can hold.
 *
 * The parameter is typed to the catalogue in `packages/db`, so a permission that
 * no migration has created cannot be named here. That turns the classic version
 * of this bug — a typo that produces a route nobody can ever reach, discovered
 * by a confused user rather than by CI — into a compile error.
 */
export const RequirePermission = (permission: PermissionKey) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

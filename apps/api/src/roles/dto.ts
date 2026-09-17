import { PERMISSION_KEYS } from "@legal/db";
import { z } from "zod";

const uuid = z.string().uuid();

/**
 * Typed to the catalogue, so a key no migration has created is a 400 here
 * rather than a foreign key violation later — and so the error names the
 * field. The database still refuses an unknown key; this is the friendlier
 * first line.
 */
const permissionKey = z.enum(PERMISSION_KEYS);

const name = z.string().trim().min(1).max(100);
const description = z.string().trim().min(1).max(500).nullish();

export const roleIdSchema = uuid;
export const userIdSchema = uuid;

export const createRoleSchema = z
  .object({
    name,
    description,
    permissionKeys: z.array(permissionKey).default([]),
  })
  .strict();

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

/**
 * `permissionKeys`, when present, is the whole set — not a delta. A role's
 * permissions are a single thing to read and reason about, and "add these,
 * remove those" is how two administrators editing at once end up with a set
 * neither of them chose.
 */
export const updateRoleSchema = z
  .object({
    name: name.optional(),
    description,
    permissionKeys: z.array(permissionKey).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

/** The whole set, for the same reason. An empty array removes every role. */
export const setUserRolesSchema = z
  .object({ roleIds: z.array(uuid) })
  .strict();

export type SetUserRolesInput = z.infer<typeof setUserRolesSchema>;

import { asc, eq, sql } from "drizzle-orm";
import { users, type User } from "../schema/index.js";
import { currentFirmId, type TenantTransaction } from "../tenant-context.js";

/**
 * The users repository.
 *
 * Every function takes the transaction handed out by `withTenant` and nothing
 * else. There is no overload accepting a raw client, and none should be added:
 * a caller holding only a `TenantTransaction` cannot reach the database except
 * through a connection that already carries a tenant context, so the row-level
 * security policies are always in force for anything written here.
 *
 * That is what makes the tenant filter an invariant rather than a habit. Nothing
 * below mentions `firm_id` in a WHERE clause — the policy supplies it, and a
 * query that forgot it would return zero rows rather than another firm's users.
 */

/**
 * Re-exported so the package's public entry point can expose the row type
 * without importing the table it comes from.
 */
export type { User } from "../schema/index.js";

export interface CreateUserInput {
  email: string;
  fullName: string;
  fullNameAr?: string | null;
}

/**
 * Every user of the caller's firm, disabled ones included — a disabled
 * colleague still has to render in historical views and audit entries.
 * Filter at the call site when a picker needs only active people.
 */
export async function listUsers(tx: TenantTransaction): Promise<User[]> {
  return tx.select().from(users).orderBy(asc(users.fullName));
}

/**
 * Returns undefined both for an id that does not exist and for one belonging to
 * another firm — the policy makes those indistinguishable, which is the
 * intended behaviour. A caller must not be able to learn from a lookup that
 * some other firm holds a given record.
 */
export async function findUserById(
  tx: TenantTransaction,
  id: string,
): Promise<User | undefined> {
  const [user] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
  return user;
}

/**
 * Case-insensitive, written to match the `users_firm_id_lower_email_key`
 * expression exactly — see the note on `findCredentialByEmail`. Returns
 * undefined for an address at another firm as readily as for one that does not
 * exist anywhere.
 */
export async function findUserByEmail(
  tx: TenantTransaction,
  email: string,
): Promise<User | undefined> {
  const [user] = await tx
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);

  return user;
}

/**
 * `firm_id` is taken from the transaction's tenant context, never from the
 * caller. There is deliberately no way to pass one: the parameter that would
 * allow a user to be created in another firm simply does not exist. The
 * policy's WITH CHECK would reject such a write anyway — this makes it
 * unexpressible a layer earlier, where the error is clearer.
 */
export async function createUser(
  tx: TenantTransaction,
  input: CreateUserInput,
): Promise<User> {
  const firmId = await currentFirmId(tx);

  const [user] = await tx
    .insert(users)
    .values({
      firmId,
      email: input.email,
      fullName: input.fullName,
      fullNameAr: input.fullNameAr ?? null,
    })
    .returning();

  if (!user) {
    throw new Error("createUser: insert returned no row");
  }

  return user;
}

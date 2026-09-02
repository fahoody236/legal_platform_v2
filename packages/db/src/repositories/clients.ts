import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { clientRepresentatives } from "../schema/client_representatives.js";
import { clients } from "../schema/clients.js";
import { currentFirmId, type TenantTransaction } from "../tenant-context.js";
import type { ClientType } from "../schema/clients.js";
import type { Client } from "../schema/clients.js";
import type { ClientRepresentative } from "../schema/client_representatives.js";

/**
 * The clients repository.
 *
 * Same contract as cases: every function takes the transaction from
 * `withTenant`, no query names `firm_id`, and a row belonging to another firm is
 * not a row this code declines to return — it is one the connection cannot see.
 * That is what makes "unknown" and "another firm's" the same outcome without a
 * branch that could drift apart later.
 */

export { CLIENT_TYPES } from "../schema/clients.js";
export type { Client, ClientType, NewClient } from "../schema/clients.js";
export type {
  ClientRepresentative,
  NewClientRepresentative,
} from "../schema/client_representatives.js";

export interface ListClientsFilters {
  clientType?: ClientType | undefined;
  /** true: only archived. false: only active. Absent: both. */
  archived?: boolean | undefined;
  limit: number;
  offset: number;
}

export interface ListClientsResult {
  items: Client[];
  /** Matching rows in the caller's firm, before limit and offset. */
  total: number;
}

/**
 * A page of the firm's clients.
 *
 * Ordered by `created_at` then `id`, not by name. Ordering Arabic names is a
 * collation decision — which `ar` collation, and how it treats the alef and
 * hamza variants that also complicate search (CLAUDE.md) — and picking one
 * silently here would make it a default nobody chose. Insertion order is the
 * honest placeholder; the `id` tiebreak keeps offset pagination from repeating
 * or skipping a row.
 */
export async function listClients(
  tx: TenantTransaction,
  filters: ListClientsFilters,
): Promise<ListClientsResult> {
  const conditions = [
    filters.clientType ? eq(clients.clientType, filters.clientType) : undefined,
    filters.archived === undefined
      ? undefined
      : filters.archived
        ? isNotNull(clients.archivedAt)
        : isNull(clients.archivedAt),
  ].filter((condition) => condition !== undefined);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const items = await tx
    .select()
    .from(clients)
    .where(where)
    .orderBy(desc(clients.createdAt), desc(clients.id))
    .limit(filters.limit)
    .offset(filters.offset);

  const [totals] = await tx
    .select({ value: count() })
    .from(clients)
    .where(where);

  return { items, total: totals?.value ?? 0 };
}

export interface ClientWithRepresentatives extends Client {
  /**
   * Always present, always empty for an individual — the composite foreign key
   * makes a representative of a natural person unrepresentable, so this is not
   * a case the caller has to handle, only one it will observe.
   */
  representatives: ClientRepresentative[];
}

/**
 * One client and everyone who acts for it.
 *
 * Two statements rather than a join, deliberately. A join would repeat every
 * client column once per representative and leave the caller to fold the rows
 * back up — cheap to get subtly wrong, and wrong in the direction of showing
 * one client as several. Both run inside the caller's transaction, so they see
 * one consistent picture.
 *
 * Archived representatives are included: the page that shows a company needs to
 * be able to say who used to sign for it. Filter at the call site.
 */
export async function findClientById(
  tx: TenantTransaction,
  id: string,
): Promise<ClientWithRepresentatives | undefined> {
  const [client] = await tx
    .select()
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);

  if (!client) {
    return undefined;
  }

  const representatives = await tx
    .select()
    .from(clientRepresentatives)
    .where(eq(clientRepresentatives.clientId, id))
    .orderBy(desc(clientRepresentatives.createdAt), desc(clientRepresentatives.id));

  return { ...client, representatives };
}

export interface CreateClientInput {
  clientType: ClientType;
  nameAr: string;
  name?: string | null;
  nationalId?: string | null;
  commercialRegistration?: string | null;
  vatNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

/**
 * `firm_id` comes from the tenant context, never from the caller — as with
 * `createUser` and `createCase`, the parameter that would file a client into
 * another firm does not exist.
 *
 * The identifier rules are checked before this by the request schema and after
 * it by `clients_identifier_by_type_check`. Both, on purpose: the schema so the
 * caller gets a 400 naming the problem, the constraint so no other path into
 * this table can write a row the rules forbid.
 *
 * Named `createClientRecord`, not `createClient`, because `createClient` is
 * already the connection factory on this package's public surface. Two exports
 * with one name do not collide loudly — the explicit export wins and the star
 * export is silently shadowed, so `createClient(tx, input)` would compile
 * against the pool factory and fail somewhere else entirely.
 */
export async function createClientRecord(
  tx: TenantTransaction,
  input: CreateClientInput,
): Promise<Client> {
  const firmId = await currentFirmId(tx);

  const [row] = await tx
    .insert(clients)
    .values({
      firmId,
      clientType: input.clientType,
      nameAr: input.nameAr,
      name: input.name ?? null,
      nationalId: input.nationalId ?? null,
      commercialRegistration: input.commercialRegistration ?? null,
      vatNumber: input.vatNumber ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      notes: input.notes ?? null,
    })
    .returning();

  if (!row) {
    throw new Error("createClient: insert returned no row");
  }

  return row;
}

/**
 * The editable surface of a client.
 *
 * `clientType` is absent, and that absence is the enforcement. See the note on
 * `updateClient` for why the type is fixed at creation.
 *
 * The identifiers *are* editable, because a mistyped national ID has to be
 * correctable and a company that registers for VAT later has to be able to say
 * so. What they cannot do is contradict the type, which the caller checks
 * against the stored type and the CHECK constraint refuses regardless.
 */
export interface UpdateClientInput {
  nameAr?: string | undefined;
  name?: string | null | undefined;
  nationalId?: string | undefined;
  commercialRegistration?: string | undefined;
  vatNumber?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  notes?: string | null | undefined;
}

/**
 * Applies the given fields, or returns undefined if the client is not visible
 * in this tenant context.
 *
 * **`client_type` cannot be changed, here or anywhere.** Not because the
 * transition is hard to implement — it is two column writes — but because it is
 * not an edit:
 *
 *   * It re-identifies the client. Flipping the type means clearing one
 *     identifier and supplying a different one, so the row afterwards describes
 *     a different legal person from the row before. The cases already filed
 *     against it, and every audit entry naming it, silently come to mean
 *     something else.
 *   * It changes which unique index deduplicates the client. A company is
 *     deduplicated on commercial registration, an individual on national ID, so
 *     the same real client can end up recorded twice with nothing objecting.
 *   * It is almost always a data-entry error, and the correct repair for that is
 *     a new client and an archive of the wrong one — which leaves both in the
 *     history, where a conflict check can still see them.
 *
 * Enforced in three places, none of which is a convention: this interface has no
 * such field, the request schema is `.strict()` so sending one is a 400 rather
 * than a silent no-op, and the database refuses any resulting row whose
 * identifiers do not match its type. Note the last is not immutability itself —
 * a coordinated flip of type *and* identifiers would satisfy the CHECK. Closing
 * that would take a trigger; nothing in the application can express it today.
 */
export async function updateClient(
  tx: TenantTransaction,
  id: string,
  input: UpdateClientInput,
): Promise<Client | undefined> {
  const values = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );

  if (Object.keys(values).length === 0) {
    const [row] = await tx
      .select()
      .from(clients)
      .where(eq(clients.id, id))
      .limit(1);
    return row;
  }

  const [row] = await tx
    .update(clients)
    .set(values)
    .where(eq(clients.id, id))
    .returning();

  return row;
}

/**
 * Archives a client. Idempotent, and the first timestamp wins.
 *
 * `coalesce` rather than a `WHERE archived_at IS NULL` guard: that guard would
 * make a second archive return no rows, which the caller would have to
 * distinguish from "no such client" and would eventually report as a 404 for a
 * client the firm can plainly see. Keeping the original timestamp matters
 * because it is the answer to "when did this firm stop acting for them".
 *
 * There is no unarchive here. Archiving is reversible in principle — the column
 * is nullable — but a route for it is a product decision, not something to leak
 * out of a repository by accident.
 */
export async function archiveClient(
  tx: TenantTransaction,
  id: string,
): Promise<Client | undefined> {
  const [row] = await tx
    .update(clients)
    .set({ archivedAt: sql`coalesce(${clients.archivedAt}, now())` })
    .where(eq(clients.id, id))
    .returning();

  return row;
}

export interface AddRepresentativeInput {
  nameAr: string;
  name?: string | null;
  nationalId?: string | null;
  role: string;
}

/**
 * Adds a representative to a company client.
 *
 * `client_type` is written as the literal `'company'` rather than being read
 * from the parent, which looks like a shortcut and is the opposite. The foreign
 * key references `clients (firm_id, id, client_type)`, so this row can only
 * attach to a client that is genuinely a company in the caller's firm — an
 * individual client, and another firm's company, both fail as the same foreign
 * key violation. Reading the parent's type first and passing it through would
 * turn that guarantee into a read the caller could get wrong.
 */
export async function addRepresentative(
  tx: TenantTransaction,
  clientId: string,
  input: AddRepresentativeInput,
): Promise<ClientRepresentative> {
  const firmId = await currentFirmId(tx);

  const [row] = await tx
    .insert(clientRepresentatives)
    .values({
      firmId,
      clientId,
      clientType: "company",
      nameAr: input.nameAr,
      name: input.name ?? null,
      nationalId: input.nationalId ?? null,
      role: input.role,
    })
    .returning();

  if (!row) {
    throw new Error("addRepresentative: insert returned no row");
  }

  return row;
}

export async function findRepresentativeById(
  tx: TenantTransaction,
  id: string,
): Promise<ClientRepresentative | undefined> {
  const [row] = await tx
    .select()
    .from(clientRepresentatives)
    .where(eq(clientRepresentatives.id, id))
    .limit(1);

  return row;
}

/**
 * `clientId` and `clientType` are absent: moving a representative to a
 * different company is not an edit to this person's details, and the type is
 * what ties the row to a company at all.
 */
export interface UpdateRepresentativeInput {
  nameAr?: string | undefined;
  name?: string | null | undefined;
  nationalId?: string | null | undefined;
  role?: string | undefined;
}

export async function updateRepresentative(
  tx: TenantTransaction,
  id: string,
  input: UpdateRepresentativeInput,
): Promise<ClientRepresentative | undefined> {
  const values = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );

  if (Object.keys(values).length === 0) {
    return findRepresentativeById(tx, id);
  }

  const [row] = await tx
    .update(clientRepresentatives)
    .set(values)
    .where(eq(clientRepresentatives.id, id))
    .returning();

  return row;
}

/** Same idempotent shape as `archiveClient`, for the same reasons. */
export async function archiveRepresentative(
  tx: TenantTransaction,
  id: string,
): Promise<ClientRepresentative | undefined> {
  const [row] = await tx
    .update(clientRepresentatives)
    .set({
      archivedAt: sql`coalesce(${clientRepresentatives.archivedAt}, now())`,
    })
    .where(eq(clientRepresentatives.id, id))
    .returning();

  return row;
}

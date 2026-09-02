import { Inject, Injectable } from "@nestjs/common";
import {
  addRepresentative,
  archiveClient,
  archiveRepresentative,
  createClientRecord,
  findClientById,
  findRepresentativeById,
  listClients,
  updateClient,
  updateRepresentative,
  withTenant,
  type AddRepresentativeInput,
  type Client,
  type ClientRepresentative,
  type ClientType,
  type ClientWithRepresentatives,
  type CreateClientInput,
  type Database,
  type ListClientsFilters,
  type ListClientsResult,
  type UpdateClientInput,
  type UpdateRepresentativeInput,
} from "@legal/db";
import { AuditService } from "../audit/audit.service.js";
import type { Actor } from "../common/request-context.js";
import { DATABASE } from "../database/database.module.js";

/**
 * An update whose identifiers would contradict the client's stored type.
 *
 * A typed outcome rather than an exception, following AuthService: the service
 * stays free of HTTP, and the controller cannot forget to handle the case
 * because the return type will not let it.
 */
export type UpdateClientOutcome =
  | { outcome: "updated"; client: Client }
  | { outcome: "not_found" }
  | { outcome: "conflicts_with_type"; clientType: ClientType };

@Injectable()
export class ClientsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: Actor,
    filters: ListClientsFilters,
  ): Promise<ListClientsResult> {
    return withTenant(this.db, actor.firmId, (tx) => listClients(tx, filters));
  }

  async findById(
    actor: Actor,
    id: string,
  ): Promise<ClientWithRepresentatives | undefined> {
    return withTenant(this.db, actor.firmId, (tx) => findClientById(tx, id));
  }

  /**
   * As with cases, every write records its entry inside the same transaction as
   * the change, and `detail` carries keys and controlled values rather than
   * content. Note what is *not* recorded: a client's name, phone or notes. The
   * audit log cannot be edited or deleted, so a name copied into it outlives
   * every correction made to the client record — and a firm that archives a
   * client would still be holding their details in a second table with
   * different access rules.
   *
   * The identifiers are recorded on creation, and that is a considered
   * exception: which client a firm took on is the fact a conflict check is
   * reconstructed from, and it is the one thing about the record that must not
   * be silently rewritable.
   */
  async create(actor: Actor, input: CreateClientInput): Promise<Client> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const created = await createClientRecord(tx, input);

      await this.audit.record(tx, {
        action: "clients.created",
        resourceType: "client",
        resourceId: created.id,
        actorUserId: actor.userId,
        detail: {
          clientType: created.clientType,
          nationalId: created.nationalId,
          commercialRegistration: created.commercialRegistration,
        },
        ip: actor.ip,
      });

      return created;
    });
  }

  /**
   * Checks the merged row against the stored type before writing.
   *
   * The request schema cannot do this: it never sees the stored client, so it
   * cannot know that `{ commercialRegistration }` is fine for a company and
   * nonsense for an individual. So the rule is applied here, against the row
   * that will actually exist — and the CHECK constraint still refuses the write
   * if this is ever wrong, which is the difference between two lines of defence
   * and one line stated twice.
   */
  async update(
    actor: Actor,
    id: string,
    input: UpdateClientInput,
  ): Promise<UpdateClientOutcome> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const before = await findClientById(tx, id);

      if (!before) {
        return { outcome: "not_found" };
      }

      if (!identifiersMatchType(before.clientType, input)) {
        return { outcome: "conflicts_with_type", clientType: before.clientType };
      }

      const updated = await updateClient(tx, id, input);

      if (!updated) {
        return { outcome: "not_found" };
      }

      await this.audit.record(tx, {
        action: "clients.updated",
        resourceType: "client",
        resourceId: updated.id,
        actorUserId: actor.userId,
        detail: { changed: Object.keys(input).sort() },
        ip: actor.ip,
      });

      return { outcome: "updated", client: updated };
    });
  }

  async archive(actor: Actor, id: string): Promise<Client | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const before = await findClientById(tx, id);

      if (!before) {
        return undefined;
      }

      const archived = await archiveClient(tx, id);

      if (!archived) {
        return undefined;
      }

      await this.audit.record(tx, {
        action: "clients.archived",
        resourceType: "client",
        resourceId: archived.id,
        actorUserId: actor.userId,
        // Recorded even when it changed nothing. Someone performed the act, and
        // a trail that silently drops repeats cannot answer "who tried".
        detail: { alreadyArchived: before.archivedAt !== null },
        ip: actor.ip,
      });

      return archived;
    });
  }

  /**
   * The client is not read first. Whether it exists, belongs to this firm, and
   * is a company are all settled by the composite foreign key — a read here
   * would be a second, weaker copy of that check, and one that could disagree
   * with it under concurrency.
   */
  async addRepresentative(
    actor: Actor,
    clientId: string,
    input: AddRepresentativeInput,
  ): Promise<ClientRepresentative> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const created = await addRepresentative(tx, clientId, input);

      await this.audit.record(tx, {
        action: "clients.representative.added",
        resourceType: "client_representative",
        resourceId: created.id,
        actorUserId: actor.userId,
        detail: { clientId: created.clientId, role: created.role },
        ip: actor.ip,
      });

      return created;
    });
  }

  async updateRepresentative(
    actor: Actor,
    id: string,
    input: UpdateRepresentativeInput,
  ): Promise<ClientRepresentative | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const updated = await updateRepresentative(tx, id, input);

      if (!updated) {
        return undefined;
      }

      await this.audit.record(tx, {
        action: "clients.representative.updated",
        resourceType: "client_representative",
        resourceId: updated.id,
        actorUserId: actor.userId,
        detail: { clientId: updated.clientId, changed: Object.keys(input).sort() },
        ip: actor.ip,
      });

      return updated;
    });
  }

  async archiveRepresentative(
    actor: Actor,
    id: string,
  ): Promise<ClientRepresentative | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const before = await findRepresentativeById(tx, id);

      if (!before) {
        return undefined;
      }

      const archived = await archiveRepresentative(tx, id);

      if (!archived) {
        return undefined;
      }

      await this.audit.record(tx, {
        action: "clients.representative.archived",
        resourceType: "client_representative",
        resourceId: archived.id,
        actorUserId: actor.userId,
        detail: {
          clientId: archived.clientId,
          alreadyArchived: before.archivedAt !== null,
        },
        ip: actor.ip,
      });

      return archived;
    });
  }
}

/**
 * The same rule migration 0011 states as `clients_identifier_by_type_check`,
 * applied to a patch against a known type.
 *
 * Only keys the caller actually sent are considered — a PATCH that never
 * mentions an identifier cannot contradict anything. Clearing a required
 * identifier is impossible earlier: the schema types those fields as strings
 * rather than nullable, so `null` never reaches here.
 */
function identifiersMatchType(
  clientType: ClientType,
  input: UpdateClientInput,
): boolean {
  if (clientType === "individual") {
    return (
      input.commercialRegistration === undefined &&
      (input.vatNumber === undefined || input.vatNumber === null)
    );
  }

  return input.nationalId === undefined;
}

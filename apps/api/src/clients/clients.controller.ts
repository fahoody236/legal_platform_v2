import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type {
  Client,
  ClientRepresentative,
  ClientWithRepresentatives,
} from "@legal/db";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { actorOf, translateWriteError } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { RequirePermission } from "../permissions/require-permission.decorator.js";
import { ClientsService } from "./clients.service.js";
import {
  addRepresentativeSchema,
  createClientSchema,
  idSchema,
  listClientsQuerySchema,
  updateClientSchema,
  updateRepresentativeSchema,
  type AddRepresentativeInput,
  type CreateClientInput,
  type ListClientsQuery,
  type UpdateClientInput,
  type UpdateRepresentativeInput,
} from "./dto.js";

/**
 * `clients.view` reads, `clients.manage` writes.
 *
 * One permission covers create, edit, archive and every representative change —
 * unlike cases, where assignment is split out. Nothing here allocates work or
 * reveals who is on what, so there is no second audience for a narrower grant,
 * and a permission nobody would grant separately is a permission that only
 * makes the role screen longer (docs/decisions/0004-permissions.md).
 */
@Controller("clients")
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @RequirePermission("clients.view")
  @Get()
  async list(
    @Query(new ZodValidationPipe(listClientsQuerySchema))
    query: ListClientsQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<{
    clients: Client[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const { items, total } = await this.clients.list(actorOf(request), query);

    return { clients: items, total, limit: query.limit, offset: query.offset };
  }

  /** Includes representatives — always an empty list for an individual. */
  @RequirePermission("clients.view")
  @Get(":id")
  async findOne(
    @Param("id", new ZodValidationPipe(idSchema)) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ client: ClientWithRepresentatives }> {
    const found = await this.clients.findById(actorOf(request), id);

    if (!found) {
      throw new NotFoundException();
    }

    return { client: found };
  }

  @RequirePermission("clients.manage")
  @Post()
  async create(
    @Body(new ZodValidationPipe(createClientSchema)) body: CreateClientInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ client: Client }> {
    try {
      return { client: await this.clients.create(actorOf(request), body) };
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  /**
   * `client_type` is not an accepted key and the schema is strict, so an attempt
   * to change it is a 400 rather than a silently ignored field. A patch whose
   * identifiers contradict the stored type is also a 400 — see
   * ClientsService.update for why that check cannot live in the schema.
   */
  @RequirePermission("clients.manage")
  @Patch(":id")
  async update(
    @Param("id", new ZodValidationPipe(idSchema)) id: string,
    @Body(new ZodValidationPipe(updateClientSchema)) body: UpdateClientInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ client: Client }> {
    let result;

    try {
      result = await this.clients.update(actorOf(request), id, body);
    } catch (error) {
      throw translateWriteError(error);
    }

    switch (result.outcome) {
      case "updated":
        return { client: result.client };
      case "conflicts_with_type":
        throw new BadRequestException();
      case "not_found":
        throw new NotFoundException();
    }
  }

  /**
   * POST rather than DELETE, and the verb is the point. Nothing in this product
   * deletes a client — the database grants no DELETE on the table — so a DELETE
   * route would name an operation that cannot happen.
   *
   * Idempotent: archiving an archived client succeeds and keeps the original
   * timestamp.
   */
  @RequirePermission("clients.manage")
  @Post(":id/archive")
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param("id", new ZodValidationPipe(idSchema)) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ client: Client }> {
    const archived = await this.clients.archive(actorOf(request), id);

    if (!archived) {
      throw new NotFoundException();
    }

    return { client: archived };
  }

  /**
   * A 404 here covers three things a caller must not be able to tell apart: no
   * such client, another firm's client, and an individual rather than a company.
   * All three arrive as the same foreign key violation, because the key carries
   * both `firm_id` and `client_type`.
   */
  @RequirePermission("clients.manage")
  @Post(":id/representatives")
  async addRepresentative(
    @Param("id", new ZodValidationPipe(idSchema)) id: string,
    @Body(new ZodValidationPipe(addRepresentativeSchema))
    body: AddRepresentativeInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ representative: ClientRepresentative }> {
    try {
      return {
        representative: await this.clients.addRepresentative(
          actorOf(request),
          id,
          body,
        ),
      };
    } catch (error) {
      throw translateWriteError(error);
    }
  }
}

/**
 * Representatives are addressed by their own id rather than nested under a
 * client, because the id is enough: the tenant policy scopes the row, so there
 * is nothing a `/clients/:clientId/representatives/:id` path would additionally
 * verify — it would only add a second identifier that can disagree with the
 * first.
 */
@Controller("representatives")
export class RepresentativesController {
  constructor(private readonly clients: ClientsService) {}

  @RequirePermission("clients.manage")
  @Patch(":id")
  async update(
    @Param("id", new ZodValidationPipe(idSchema)) id: string,
    @Body(new ZodValidationPipe(updateRepresentativeSchema))
    body: UpdateRepresentativeInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ representative: ClientRepresentative }> {
    let updated: ClientRepresentative | undefined;

    try {
      updated = await this.clients.updateRepresentative(
        actorOf(request),
        id,
        body,
      );
    } catch (error) {
      throw translateWriteError(error);
    }

    if (!updated) {
      throw new NotFoundException();
    }

    return { representative: updated };
  }

  @RequirePermission("clients.manage")
  @Post(":id/archive")
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param("id", new ZodValidationPipe(idSchema)) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ representative: ClientRepresentative }> {
    const archived = await this.clients.archiveRepresentative(
      actorOf(request),
      id,
    );

    if (!archived) {
      throw new NotFoundException();
    }

    return { representative: archived };
  }
}

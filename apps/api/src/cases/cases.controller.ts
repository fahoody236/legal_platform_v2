import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Case } from "@legal/db";
import { requireSession } from "../auth/authenticated-request.js";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import {
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
  postgresErrorCode,
} from "../common/database-errors.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { RequirePermission } from "../permissions/require-permission.decorator.js";
import { requireFirmId } from "../tenant/tenant-request.js";
import { CasesService, type Actor } from "./cases.service.js";
import {
  assignCaseSchema,
  caseIdSchema,
  createCaseSchema,
  listCasesQuerySchema,
  updateCaseSchema,
  type AssignCaseInput,
  type CreateCaseInput,
  type ListCasesQuery,
  type UpdateCaseInput,
} from "./dto.js";

/**
 * Every route declares a permission. None of them is `@Public()` or
 * `@SessionOnly()`: a case is firm data, so holding a session is not the
 * question — the question is whether this firm has granted this person that
 * verb (docs/decisions/0004-permissions.md).
 *
 * `cases.edit` and `cases.assign` are separate routes because they are separate
 * permissions. Folding assignment into PATCH would have made the split in the
 * catalogue decorative.
 */
@Controller("cases")
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @RequirePermission("cases.view")
  @Get()
  async list(
    @Query(new ZodValidationPipe(listCasesQuerySchema)) query: ListCasesQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ cases: Case[]; total: number; limit: number; offset: number }> {
    const { items, total } = await this.cases.list(actorOf(request), query);

    return { cases: items, total, limit: query.limit, offset: query.offset };
  }

  /**
   * 404 for a case that does not exist and for one belonging to another firm,
   * and the two are the same code path rather than two branches that happen to
   * agree. The repository cannot see another firm's row at all, so there is
   * nothing here that could tell them apart even if it wanted to — which is the
   * only version of this guarantee worth having, since the alternative is a
   * distinction one refactor away from reappearing.
   */
  @RequirePermission("cases.view")
  @Get(":id")
  async findOne(
    @Param("id", new ZodValidationPipe(caseIdSchema)) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ case: Case }> {
    const found = await this.cases.findById(actorOf(request), id);

    if (!found) {
      throw new NotFoundException();
    }

    return { case: found };
  }

  @RequirePermission("cases.create")
  @Post()
  async create(
    @Body(new ZodValidationPipe(createCaseSchema)) body: CreateCaseInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ case: Case }> {
    try {
      return { case: await this.cases.create(actorOf(request), body) };
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  @RequirePermission("cases.edit")
  @Patch(":id")
  async update(
    @Param("id", new ZodValidationPipe(caseIdSchema)) id: string,
    @Body(new ZodValidationPipe(updateCaseSchema)) body: UpdateCaseInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ case: Case }> {
    let updated: Case | undefined;

    try {
      updated = await this.cases.update(actorOf(request), id, body);
    } catch (error) {
      throw translateWriteError(error);
    }

    if (!updated) {
      throw new NotFoundException();
    }

    return { case: updated };
  }

  @RequirePermission("cases.assign")
  @Patch(":id/assign")
  async assign(
    @Param("id", new ZodValidationPipe(caseIdSchema)) id: string,
    @Body(new ZodValidationPipe(assignCaseSchema)) body: AssignCaseInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ case: Case }> {
    let updated: Case | undefined;

    try {
      updated = await this.cases.assign(
        actorOf(request),
        id,
        body.assignedLawyerId,
      );
    } catch (error) {
      throw translateWriteError(error);
    }

    if (!updated) {
      throw new NotFoundException();
    }

    return { case: updated };
  }
}

/**
 * The acting firm comes from the Host header via the tenant middleware and the
 * acting user from the validated session. Neither is readable from the body, so
 * there is no field a caller could add to act somewhere else or as someone else.
 */
function actorOf(request: AuthenticatedRequest): Actor {
  return {
    firmId: requireFirmId(request),
    userId: requireSession(request).user.userId,
    ip: request.socket.remoteAddress ?? null,
  };
}

/**
 * Turns the two constraint violations a caller can actually cause into
 * responses.
 *
 * A foreign key violation means the client or the lawyer named in the request
 * does not exist *in this firm* — the composite keys carry `firm_id`, so
 * another firm's client and a client that was never created fail identically.
 * 404 keeps them that way. It deliberately does not say which of the two
 * references was the problem: naming it would confirm that the other one
 * resolved, which for a cross-firm id is exactly the confirmation to withhold.
 *
 * A unique violation is the case number, already used in this firm. 409 rather
 * than 404, because unlike the references above this tells the caller nothing
 * they could not learn by listing their own cases.
 *
 * Anything else is rethrown. A constraint nobody anticipated should surface as a
 * 500 and be fixed, not be flattened into a 400 that suggests the caller did
 * something wrong.
 */
function translateWriteError(error: unknown): unknown {
  const code = postgresErrorCode(error);

  if (code === PG_FOREIGN_KEY_VIOLATION) {
    return new NotFoundException();
  }

  if (code === PG_UNIQUE_VIOLATION) {
    return new ConflictException();
  }

  return error;
}

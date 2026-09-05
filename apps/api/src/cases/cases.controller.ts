import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Case, CaseWithNames } from "@legal/db";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { actorOf, translateWriteError } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { RequirePermission } from "../permissions/require-permission.decorator.js";
import { CasesService } from "./cases.service.js";
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
  ): Promise<{
    cases: CaseWithNames[];
    total: number;
    limit: number;
    offset: number;
  }> {
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
  ): Promise<{ case: CaseWithNames }> {
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

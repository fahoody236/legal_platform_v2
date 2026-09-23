import {
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
import type { Hearing, HearingWithCase } from "@legal/db";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { actorOf, translateWriteError } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { RequirePermission } from "../permissions/require-permission.decorator.js";
import {
  adjournHearingSchema,
  createHearingSchema,
  hearingIdSchema,
  listHearingsQuerySchema,
  setHearingStatusSchema,
  updateHearingSchema,
  type AdjournHearingInput,
  type CreateHearingInput,
  type ListHearingsQuery,
  type SetHearingStatusInput,
  type UpdateHearingInput,
} from "./dto.js";
import { HearingsService, type AdjournResult } from "./hearings.service.js";

/**
 * Court dates on the firm's matters.
 *
 * Two permissions rather than four. Cases and tasks split create from edit
 * from assign because a firm plausibly withholds one from someone holding the
 * others; a hearing has no assignment to withhold — the case's lawyer attends
 * — and whoever is trusted to enter a court date is the same person trusted
 * to record that it was adjourned.
 *
 * Four write routes, and the count is the point: `PATCH` corrects a hearing's
 * details, `POST :id/status` records that it happened or was called off, and
 * `POST :id/adjourn` writes the two rows an adjournment is. Folding the last
 * into the first would make "the court sat and did not proceed" a field that
 * changed rather than an event in the trail.
 */
@Controller("hearings")
export class HearingsController {
  constructor(private readonly hearings: HearingsService) {}

  /**
   * "This case's hearings", "what is coming up", and "the week of the 12th"
   * are all this route with filters rather than routes of their own. They are
   * questions about one list, and a second code path is how two lists come to
   * disagree about what counts as archived.
   */
  @RequirePermission("hearings.view")
  @Get()
  async list(
    @Query(new ZodValidationPipe(listHearingsQuerySchema))
    query: ListHearingsQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<{
    hearings: HearingWithCase[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const { items, total } = await this.hearings.list(actorOf(request), query);

    return { hearings: items, total, limit: query.limit, offset: query.offset };
  }

  @RequirePermission("hearings.view")
  @Get(":id")
  async findOne(
    @Param("id", new ZodValidationPipe(hearingIdSchema)) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ hearing: HearingWithCase }> {
    const found = await this.hearings.findById(actorOf(request), id);

    if (!found) {
      throw new NotFoundException();
    }

    return { hearing: found };
  }

  /** 404 for a case in another firm, as for every reference that cannot resolve. */
  @RequirePermission("hearings.manage")
  @Post()
  async create(
    @Body(new ZodValidationPipe(createHearingSchema)) body: CreateHearingInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ hearing: Hearing }> {
    try {
      return { hearing: await this.hearings.create(actorOf(request), body) };
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  @RequirePermission("hearings.manage")
  @Patch(":id")
  async update(
    @Param("id", new ZodValidationPipe(hearingIdSchema)) id: string,
    @Body(new ZodValidationPipe(updateHearingSchema)) body: UpdateHearingInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ hearing: Hearing }> {
    let updated: Hearing | undefined;

    try {
      updated = await this.hearings.update(actorOf(request), id, body);
    } catch (error) {
      throw translateWriteError(error);
    }

    if (!updated) {
      throw new NotFoundException();
    }

    return { hearing: updated };
  }

  /**
   * Held, cancelled, or corrected back to scheduled — with what happened, if
   * the caller has it.
   *
   * `adjourned` is refused by the schema with a 400 naming the other route.
   * POST rather than PATCH for the same reason task completion is: this is an
   * act with a name, not a field being set.
   */
  @RequirePermission("hearings.manage")
  @Post(":id/status")
  @HttpCode(HttpStatus.OK)
  async setStatus(
    @Param("id", new ZodValidationPipe(hearingIdSchema)) id: string,
    @Body(new ZodValidationPipe(setHearingStatusSchema))
    body: SetHearingStatusInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ hearing: Hearing }> {
    const updated = await this.hearings.setStatus(actorOf(request), id, body);

    if (!updated) {
      throw new NotFoundException();
    }

    return { hearing: updated };
  }

  /**
   * The court sat and did not proceed.
   *
   * One request, one transaction, two rows: this hearing closes as `adjourned`
   * and a successor is created where a date was given. Omitting the date
   * records the adjournment alone, which is what a court adjourning إلى أجل
   * غير مسمى produces — the alternative is people inventing a date to satisfy
   * the form.
   */
  @RequirePermission("hearings.manage")
  @Post(":id/adjourn")
  @HttpCode(HttpStatus.OK)
  async adjourn(
    @Param("id", new ZodValidationPipe(hearingIdSchema)) id: string,
    @Body(new ZodValidationPipe(adjournHearingSchema))
    body: AdjournHearingInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<AdjournResult> {
    let result: AdjournResult | undefined;

    try {
      result = await this.hearings.adjourn(actorOf(request), id, body);
    } catch (error) {
      throw translateWriteError(error);
    }

    if (!result) {
      throw new NotFoundException();
    }

    return result;
  }
}

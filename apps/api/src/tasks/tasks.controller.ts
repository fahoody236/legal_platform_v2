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
import type { Task, TaskWithNames } from "@legal/db";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { actorOf, translateWriteError } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { RequirePermission } from "../permissions/require-permission.decorator.js";
import {
  assignTaskSchema,
  createTaskSchema,
  listTasksQuerySchema,
  taskIdSchema,
  updateTaskSchema,
  type AssignTaskInput,
  type CreateTaskInput,
  type ListTasksQuery,
  type UpdateTaskInput,
} from "./dto.js";
import { TasksService } from "./tasks.service.js";

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  /**
   * "My tasks" and "overdue" are both this route with filters, rather than
   * routes of their own. They are questions about the same list, and a
   * `/tasks/mine` would be a second code path answering one of them — which is
   * how two lists come to disagree about what counts as archived.
   */
  @RequirePermission("tasks.view")
  @Get()
  async list(
    @Query(new ZodValidationPipe(listTasksQuerySchema)) query: ListTasksQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<{
    tasks: TaskWithNames[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const { items, total } = await this.tasks.list(actorOf(request), query);

    return { tasks: items, total, limit: query.limit, offset: query.offset };
  }

  @RequirePermission("tasks.view")
  @Get(":id")
  async findOne(
    @Param("id", new ZodValidationPipe(taskIdSchema)) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ task: TaskWithNames }> {
    const found = await this.tasks.findById(actorOf(request), id);

    if (!found) {
      throw new NotFoundException();
    }

    return { task: found };
  }

  @RequirePermission("tasks.create")
  @Post()
  async create(
    @Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ task: Task }> {
    try {
      return { task: await this.tasks.create(actorOf(request), body) };
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  @RequirePermission("tasks.edit")
  @Patch(":id")
  async update(
    @Param("id", new ZodValidationPipe(taskIdSchema)) id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: UpdateTaskInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ task: Task }> {
    let updated: Task | undefined;

    try {
      updated = await this.tasks.update(actorOf(request), id, body);
    } catch (error) {
      throw translateWriteError(error);
    }

    if (!updated) {
      throw new NotFoundException();
    }

    return { task: updated };
  }

  @RequirePermission("tasks.assign")
  @Patch(":id/assign")
  async assign(
    @Param("id", new ZodValidationPipe(taskIdSchema)) id: string,
    @Body(new ZodValidationPipe(assignTaskSchema)) body: AssignTaskInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ task: Task }> {
    let updated: Task | undefined;

    try {
      updated = await this.tasks.assign(
        actorOf(request),
        id,
        body.assignedToUserId,
      );
    } catch (error) {
      throw translateWriteError(error);
    }

    if (!updated) {
      throw new NotFoundException();
    }

    return { task: updated };
  }

  /**
   * `tasks.edit`, not a permission of its own.
   *
   * Marking your own work finished is not something a firm withholds from the
   * people it asked to do the work — and if it were withheld, the task would sit
   * open forever while the person who finished it had no way to say so.
   *
   * POST rather than PATCH: this is an act with a name, not a field being set,
   * and the whole reason it exists as a route is that `status` and
   * `completed_at` have to be written together.
   */
  @RequirePermission("tasks.edit")
  @Post(":id/complete")
  @HttpCode(HttpStatus.OK)
  async complete(
    @Param("id", new ZodValidationPipe(taskIdSchema)) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ task: Task }> {
    const completed = await this.tasks.complete(actorOf(request), id);

    if (!completed) {
      throw new NotFoundException();
    }

    return { task: completed };
  }
}

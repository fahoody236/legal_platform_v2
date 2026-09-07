import { Inject, Injectable } from "@nestjs/common";
import {
  assignTask,
  completeTask,
  createTask,
  findTaskById,
  listTasks,
  updateTask,
  withTenant,
  type Database,
  type ListTasksFilters,
  type ListTasksResult,
  type Task,
  type TaskWithNames,
  type UpdateTaskInput,
} from "@legal/db";
import { AuditService } from "../audit/audit.service.js";
import type { Actor } from "../common/request-context.js";
import { DATABASE } from "../database/database.module.js";
import type { CreateTaskInput } from "./dto.js";

@Injectable()
export class TasksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor, filters: ListTasksFilters): Promise<ListTasksResult> {
    return withTenant(this.db, actor.firmId, (tx) => listTasks(tx, filters));
  }

  async findById(
    actor: Actor,
    id: string,
  ): Promise<TaskWithNames | undefined> {
    return withTenant(this.db, actor.firmId, (tx) => findTaskById(tx, id));
  }

  /**
   * `created_by_user_id` comes from the session, never the body. Who asked for
   * the work is part of what the record means, and a field a caller could set
   * would make it an assertion rather than a fact.
   */
  async create(actor: Actor, input: CreateTaskInput): Promise<Task> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const created = await createTask(tx, {
        caseId: input.caseId,
        titleAr: input.titleAr,
        title: input.title ?? null,
        description: input.description ?? null,
        assignedToUserId: input.assignedToUserId ?? null,
        status: input.status,
        priority: input.priority,
        dueAt: input.dueAt ?? null,
        createdByUserId: actor.userId,
      });

      await this.audit.record(tx, {
        action: "tasks.created",
        resourceType: "task",
        resourceId: created.id,
        actorUserId: actor.userId,
        detail: {
          caseId: created.caseId,
          status: created.status,
          priority: created.priority,
          assignedToUserId: created.assignedToUserId,
        },
        ip: actor.ip,
      });

      return created;
    });
  }

  async update(
    actor: Actor,
    id: string,
    input: UpdateTaskInput,
  ): Promise<Task | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const before = await findTaskById(tx, id);

      if (!before) {
        return undefined;
      }

      const updated = await updateTask(tx, id, input);

      if (!updated) {
        return undefined;
      }

      await this.audit.record(tx, {
        action: "tasks.updated",
        resourceType: "task",
        resourceId: updated.id,
        actorUserId: actor.userId,
        detail: {
          changed: Object.keys(input).sort(),
          ...(before.status === updated.status
            ? {}
            : { status: { from: before.status, to: updated.status } }),
        },
        ip: actor.ip,
      });

      return updated;
    });
  }

  async assign(
    actor: Actor,
    id: string,
    userId: string | null,
  ): Promise<Task | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const before = await findTaskById(tx, id);

      if (!before) {
        return undefined;
      }

      const updated = await assignTask(tx, id, userId);

      if (!updated) {
        return undefined;
      }

      await this.audit.record(tx, {
        action: "tasks.assigned",
        resourceType: "task",
        actorUserId: actor.userId,
        resourceId: updated.id,
        // Both ends. "Who was taken off this" is as much a question as "who was
        // put on it", and the previous holder is unrecoverable once overwritten.
        detail: {
          from: before.assignedToUserId,
          to: updated.assignedToUserId,
        },
        ip: actor.ip,
      });

      return updated;
    });
  }

  /**
   * Completion is its own operation, and its own audit action.
   *
   * The mechanical reason is the CHECK constraint binding `status = 'done'` to
   * `completed_at`: the pair has to be written together, which a field on an
   * edit form cannot express. The reason that outlives the constraint is this
   * entry — "who finished this and when" is a question a firm asks, and
   * `tasks.updated {changed:["status"]}` does not answer it.
   *
   * Already-complete is not an error. The repository keeps the first timestamp,
   * so pressing the button twice does not restate when the work finished; the
   * entry records that someone pressed it, which is true.
   */
  async complete(actor: Actor, id: string): Promise<Task | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const before = await findTaskById(tx, id);

      if (!before) {
        return undefined;
      }

      const completed = await completeTask(tx, id);

      if (!completed) {
        return undefined;
      }

      await this.audit.record(tx, {
        action: "tasks.completed",
        resourceType: "task",
        resourceId: completed.id,
        actorUserId: actor.userId,
        detail: {
          from: before.status,
          alreadyComplete: before.status === "done",
          assignedToUserId: completed.assignedToUserId,
        },
        ip: actor.ip,
      });

      return completed;
    });
  }
}

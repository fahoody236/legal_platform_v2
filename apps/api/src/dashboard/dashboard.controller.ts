import { Controller, Get, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { actorOf } from "../common/request-context.js";
import { SessionOnly } from "../permissions/session-only.decorator.js";
import { DashboardService, type DashboardResponse } from "./dashboard.service.js";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /**
   * `@SessionOnly()` for the same reason as search, and with the same caveat:
   * no single permission describes a page assembled from four resources each
   * gated by its own. The service applies each one, and a caller holding none
   * gets an empty object rather than a 403 — the dashboard for someone who may
   * see nothing is, correctly, a blank one.
   */
  @SessionOnly()
  @Get()
  async get(@Req() request: AuthenticatedRequest): Promise<DashboardResponse> {
    return this.dashboard.build(actorOf(request));
  }
}

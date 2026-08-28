import { Controller, Get } from "@nestjs/common";

/**
 * Liveness only. It reports that the process is up and serving, and deliberately
 * nothing else — no database check, no version, no tenant count. A health
 * endpoint is unauthenticated by nature, so anything it returns is public.
 */
@Controller("health")
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: "ok" };
  }
}

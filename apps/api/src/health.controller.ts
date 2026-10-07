import { Controller, Get } from "@nestjs/common";
import { Public } from "./auth/public.decorator.js";
import { RateLimit } from "./ratelimit/rate-limit.decorator.js";

/**
 * Liveness only. It reports that the process is up and serving, and deliberately
 * nothing else — no database check, no version, no tenant count. A health
 * endpoint is unauthenticated by nature, so anything it returns is public.
 */
@Controller("health")
export class HealthController {
  @Public()
  @RateLimit("exempt")
  @Get()
  check(): { status: string } {
    return { status: "ok" };
  }
}

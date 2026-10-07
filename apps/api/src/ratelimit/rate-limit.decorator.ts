import { SetMetadata } from "@nestjs/common";
import type { LimitClass } from "./policy.js";

export const RATE_LIMIT_CLASS = "ratelimit:class";

/**
 * Declares which limits a route is under. Absent means `read`, so a route
 * that forgets is limited rather than open; `exempt` has to be written out.
 * Typed to the policy table, so a class that does not exist is a compile
 * error rather than a route that is quietly unlimited.
 */
export const RateLimit = (limitClass: LimitClass) =>
  SetMetadata(RATE_LIMIT_CLASS, limitClass);

import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

/**
 * Parses a request body against a schema, rejecting anything that does not fit
 * before it reaches a service.
 *
 * The parsed value replaces the raw one, so a handler receives exactly the
 * declared shape — unknown keys stripped, strings trimmed, types narrowed. A
 * service can then treat its arguments as trustworthy rather than re-checking
 * them, which is the point of validating at the boundary rather than sprinkling
 * guards through the call stack.
 *
 * Validation failures return 400 with no field detail. For most endpoints the
 * detail would be helpful; for sign-in it is a disclosure channel, and having
 * one pipe behave one way everywhere is easier to reason about than a pipe with
 * an exception.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException();
    }

    return result.data;
  }
}

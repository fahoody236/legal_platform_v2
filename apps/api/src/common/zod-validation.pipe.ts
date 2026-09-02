import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodType, ZodTypeDef } from "zod";

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
  /**
   * The schema's *input* type is left open. `ZodType<T>` would pin input to
   * equal output, which excludes every schema that actually transforms —
   * `.default()`, `.coerce`, the `"true" | "false"` to boolean conversion on
   * query strings. What arrives here is a parsed request, so `unknown` is not a
   * loosening: it is the truth about the argument.
   */
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException();
    }

    return result.data;
  }
}

import { Controller, Get, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { actorOf } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { SessionOnly } from "../permissions/session-only.decorator.js";
import { searchQuerySchema, type SearchQuery } from "./dto.js";
import { SearchService, type SearchResponse } from "./search.service.js";

@Controller("search")
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /**
   * `@SessionOnly()` — and this is the case that decorator's own note warns
   * about, so the reason is worth being precise about.
   *
   * No single permission gates this route because no single permission
   * describes it. It reads clients, cases and tasks, and each of those has its
   * own permission that the service applies per group, exactly as the list
   * routes apply them. A caller with none of the three gets an empty response.
   * Declaring one of them here would be wrong in both directions: too strict
   * for someone who may see cases but not clients, and too loose for someone
   * who may see nothing.
   *
   * So the declaration says what is true — a session is required, and
   * everything beyond that is decided per group by the same rules as
   * everywhere else. What it must not become is a precedent for routes that
   * simply found a permission inconvenient.
   */
  @SessionOnly()
  @Get()
  async find(
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<SearchResponse> {
    return this.search.search(actorOf(request), query.q);
  }
}

import { SEARCH_MIN_LENGTH } from "@legal/db";
import { z } from "zod";

/**
 * Two characters minimum, and a ceiling. One character matches most of a firm's
 * records, which is a slower way of listing them; a very long term is not a
 * search, and every character is a trigram lookup.
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(SEARCH_MIN_LENGTH).max(200),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

-- Arabic normalisation for search, and the indexes that depend on it.
--
-- ── Why this is a SQL function and not application code ──────────────────────
--
-- The same Arabic name is routinely written several ways, none of them wrong:
-- with or without tashkeel, with any of four alefs, with taa marbuta or haa at
-- the end of a word. A search that compares bytes finds nothing for a person
-- who spells a name differently from whoever entered it — which, for Arabic, is
-- most of the time.
--
-- Folding those variants has to be done identically to the stored value and to
-- the query, or the two will not meet. That is only guaranteed if one function
-- computes both. Putting it here — in the database, used by the functional
-- indexes below and by the search queries — is what makes that true. The
-- interim copy in apps/web/src/lib/arabic.ts exists only because the clients
-- API had no search parameter; it is not the authority, and it should not be
-- kept in step with this one but deleted once nothing calls it.
--
-- CLAUDE.md is explicit that this scheme must be decided before the index is
-- built. This migration is that decision.
--
-- ── What it folds ────────────────────────────────────────────────────────────
--
--   * NFKC, so presentation forms and compatibility characters collapse.
--   * Tashkeel (fathatan through sukun), the superscript alef, and tatweel.
--   * Alef with hamza above/below, madda, and wasla → bare alef.
--   * Taa marbuta → haa.  Alef maqsura → yaa.
--   * Arabic-Indic and Persian digits → Latin, so a number typed either way
--     matches, and so identifiers — which are stored Latin-only by CHECK —
--     can be searched for from an Arabic keyboard.
--   * Case, runs of whitespace, and whitespace at either end.
--
-- IMMUTABLE is load-bearing: a functional index requires it, and it is true —
-- the output depends only on the input.

CREATE OR REPLACE FUNCTION normalise_arabic(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT btrim(lower(
    regexp_replace(
      translate(
        regexp_replace(
          normalize(input, NFKC),
          '[ًٌٍَُِّْٰـ]',
          '',
          'g'
        ),
        'أإآٱةى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
        'ااااهي01234567890123456789'
      ),
      '\s+',
      ' ',
      'g'
    )
  ))
$$;--> statement-breakpoint

-- Not SECURITY DEFINER, so this runs with the caller's own rights and grants
-- nothing. Execute is public by default; stated anyway, in the style of the rest
-- of this schema, so its presence is a decision rather than a default.
GRANT EXECUTE ON FUNCTION normalise_arabic(text) TO legal_app;--> statement-breakpoint

-- ── Indexes ──────────────────────────────────────────────────────────────────
--
-- Trigram GIN indexes over the normalised text. A btree cannot serve
-- `LIKE '%term%'`; trigrams can, and they also serve prefix and equality, so
-- one index per column covers every tier of the ranking.
--
-- Only the columns a person would type to find a record. Notes, courts and
-- descriptions are searched too, but they are long, they change, and they are
-- matched last — a sequential scan over them is acceptable at the sizes a
-- single firm reaches, and an index over every free-text column would cost
-- more on every write than it saves on a search.
--
-- The identifier columns (national_id, commercial_registration) need nothing:
-- they are digits-only by CHECK, so the normalised query compares to the raw
-- column and the existing unique btree indexes serve the equality.

CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

CREATE INDEX "clients_name_ar_search_idx" ON "clients"
  USING gin (normalise_arabic("name_ar") gin_trgm_ops);--> statement-breakpoint

CREATE INDEX "clients_name_search_idx" ON "clients"
  USING gin (normalise_arabic("name") gin_trgm_ops)
  WHERE "name" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "cases_case_number_search_idx" ON "cases"
  USING gin (normalise_arabic("case_number") gin_trgm_ops);--> statement-breakpoint

CREATE INDEX "cases_title_ar_search_idx" ON "cases"
  USING gin (normalise_arabic("title_ar") gin_trgm_ops);--> statement-breakpoint

CREATE INDEX "tasks_title_ar_search_idx" ON "tasks"
  USING gin (normalise_arabic("title_ar") gin_trgm_ops);

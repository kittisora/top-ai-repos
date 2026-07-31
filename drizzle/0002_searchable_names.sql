-- Custom SQL migration file, put your code below! --

-- Make repository names actually searchable.
--
-- Postgres' default text parser classifies "owner/name" as a FILE PATH and keeps
-- it as a single lexeme, so `begin0808/LiveCaption` indexed as the one token
-- 'begin0808/livecaption' and a search for "livecaption" could never match it.
-- Only owners that happened to contain a hyphen split in a way that exposed the
-- name. Measured before this change: 1 hit where 3 repositories carry the word.
--
-- Replacing the slash with a space makes the owner and the name separate lexemes,
-- and the English stemmer then folds LiveCaptions/LiveCaption onto the same stem.
-- Topics join the vector too (weight C) — they are the author's own keywords and
-- were not searchable at all before.
--
-- pg_trgm + a trigram index backs substring matching (`ILIKE '%livecap%'`), which
-- full-text search cannot do at all: it matches whole stems, never fragments.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- A generated column's expression cannot be altered in place, and dropping it
-- takes its dependent index with it.
ALTER TABLE "repositories" DROP COLUMN IF EXISTS "search_vector";

ALTER TABLE "repositories" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', replace(coalesce("full_name", ''), '/', ' ')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("topics"::text, '')), 'C')
  ) STORED;

CREATE INDEX "repositories_search_idx" ON "repositories" USING gin ("search_vector");

-- Supports ILIKE '%fragment%' on the full name, which no btree index can serve.
CREATE INDEX "repositories_full_name_trgm_idx"
  ON "repositories" USING gin ("full_name" gin_trgm_ops);

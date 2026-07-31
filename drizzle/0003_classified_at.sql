-- Custom SQL migration file, put your code below! --

-- Track classification ATTEMPTS, not just successful assignments.
--
-- The candidate query ordered by `max(assigned_at)` over repository_categories,
-- so a repository the classifier could not place — the LLM answering
-- `is_ai_related: false`, or the rules finding nothing — wrote no rows, kept a
-- NULL ordering key, and sorted FIRST on the very next run. Every run re-sent the
-- same unplaceable repositories to the model, forever, at a cost per call.
--
-- Recording the attempt on the repository row breaks that loop: an unplaceable
-- repo is now "recently attempted" and goes to the back of the queue like any
-- other. It also replaces a correlated subquery in the ORDER BY with an indexed
-- column.

ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "classified_at" timestamp with time zone;

-- Least-recently-attempted first, never-attempted before everything.
CREATE INDEX IF NOT EXISTS "repositories_classify_queue_idx"
  ON "repositories" ("classified_at" NULLS FIRST);

-- Seed from existing assignments so the first run after this migration does not
-- treat the whole already-classified index as brand new work.
UPDATE "repositories" r
SET "classified_at" = sub.last_assigned
FROM (
  SELECT repository_id, MAX(assigned_at) AS last_assigned
  FROM "repository_categories" GROUP BY repository_id
) sub
WHERE r.id = sub.repository_id AND r."classified_at" IS NULL;

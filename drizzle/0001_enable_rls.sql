-- Custom SQL migration file, put your code below! --

-- Lock down the public REST API (Supabase advisory: rls_disabled_in_public).
--
-- Supabase exposes every public-schema table through PostgREST + the anon key.
-- These tables were created by Drizzle migrations, so — unlike dashboard-made
-- tables — they never had Row-Level Security enabled, leaving them readable,
-- writable and DELETE-able by anyone with the project URL and anon key.
--
-- Enabling RLS with NO policies denies all access to the anon/authenticated
-- roles (default-deny). The ingestion workers and the Next.js app connect as
-- the `postgres` role, which has BYPASSRLS, so they are entirely unaffected —
-- the public read path is the website (server-side), never the anon API.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is a no-op if already enabled.

ALTER TABLE "repositories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repository_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repository_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contributors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repository_contributors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "discovery_shards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_runs" ENABLE ROW LEVEL SECURITY;

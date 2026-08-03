/**
 * Site-wide aggregates: the homepage header numbers, the geography view and the
 * language filter's options.
 *
 * These are full-table aggregates. They are written as plain grouped queries
 * rather than materialised views because the ingestion pipeline rewrites the
 * repositories table on every sync, and a view would need refreshing on exactly
 * the same cadence for no gain.
 *
 * What they are NOT is cheap. Each one touches every active repository (and
 * getCountryStats every contributor too), the pages that show them are all
 * force-dynamic, and the corpus is ~30k repos and ~53k contributors — so every
 * one of these is exported through the TTL memo in ./cache. The results only
 * change when the daily pipeline runs; re-deriving them per request was the
 * single largest source of this project's database egress and read IO.
 */

import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { categories, contributors, repositories, syncRuns } from '@/db/schema';
import { AGGREGATE_TTL_MS, memoize } from './cache';

export interface GlobalStats {
  /** Active (non-rejected) repositories in the index, archived included. */
  repositories: number;
  categories: number;
  /** Sum of stars across the index — the "stars tracked" headline. */
  starsTracked: number;
  /** Stars gained across the whole index in the last 7 days. */
  starsThisWeek: number;
  reposAddedThisWeek: number;
  contributors: number;
  countries: number;
  languages: number;
  lastSyncAt: Date | null;
  lastSyncJob: string | null;
  lastSyncStats: Record<string, number | string> | null;
}

async function loadGlobalStats(): Promise<GlobalStats> {
  const [repoTotals, categoryTotal, contributorTotal, lastSync] = await Promise.all([
    // One pass over repositories for six numbers — FILTER lets a conditional
    // count ride along on the same scan instead of costing another query.
    db
      .select({
        repositories: sql<number>`count(*)`.mapWith(Number),
        starsTracked: sql<number>`coalesce(sum(${repositories.stars}), 0)`.mapWith(Number),
        starsThisWeek: sql<number>`coalesce(sum(${repositories.starsWeek}), 0)`.mapWith(
          Number,
        ),
        reposAddedThisWeek: sql<number>`count(*) filter (where ${repositories.firstSeenAt} >= now() - interval '7 days')`.mapWith(
          Number,
        ),
        languages: sql<number>`count(distinct ${repositories.language})`.mapWith(Number),
        countries: sql<number>`count(distinct ${repositories.ownerCountry})`.mapWith(Number),
      })
      .from(repositories)
      .where(eq(repositories.status, 'active')),

    db.select({ total: count() }).from(categories),
    db.select({ total: count() }).from(contributors),

    // The most recent run that actually finished cleanly. A currently-running
    // or failed run must not be reported as "last updated".
    db
      .select({
        job: syncRuns.job,
        finishedAt: syncRuns.finishedAt,
        stats: syncRuns.stats,
      })
      .from(syncRuns)
      .where(eq(syncRuns.status, 'ok'))
      .orderBy(desc(syncRuns.finishedAt))
      .limit(1),
  ]);

  const totals = repoTotals[0];
  const sync = lastSync[0];

  return {
    repositories: totals?.repositories ?? 0,
    categories: categoryTotal[0]?.total ?? 0,
    starsTracked: totals?.starsTracked ?? 0,
    starsThisWeek: totals?.starsThisWeek ?? 0,
    reposAddedThisWeek: totals?.reposAddedThisWeek ?? 0,
    contributors: contributorTotal[0]?.total ?? 0,
    countries: totals?.countries ?? 0,
    languages: totals?.languages ?? 0,
    lastSyncAt: sync?.finishedAt ?? null,
    lastSyncJob: sync?.job ?? null,
    lastSyncStats: sync?.stats ?? null,
  };
}

/**
 * Read by the homepage stat tiles AND by the explorer on every filtered view, so
 * this is the most-called query in the app. `count(distinct language)` and
 * `count(distinct owner_country)` cannot use an index — they are a sort or a hash
 * over every active row — which is why it is memoised rather than merely indexed.
 */
export const getGlobalStats = memoize(loadGlobalStats, AGGREGATE_TTL_MS);

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

export interface CountryStat {
  country: string;
  repoCount: number;
  totalStars: number;
  contributorCount: number;
}

/**
 * Repos are attributed by the owner's normalised country; contributors by their
 * own. They are genuinely different populations — a repo owned by a US org can
 * be built mostly by people elsewhere — so they are aggregated separately and
 * merged, rather than joined into a number that means neither.
 */
async function loadCountryStats(): Promise<CountryStat[]> {
  const [repoRows, contributorRows] = await Promise.all([
    db
      .select({
        country: repositories.ownerCountry,
        repoCount: count(),
        totalStars: sql<number>`coalesce(sum(${repositories.stars}), 0)`.mapWith(Number),
      })
      .from(repositories)
      .where(and(eq(repositories.status, 'active'), isNotNull(repositories.ownerCountry)))
      .groupBy(repositories.ownerCountry),

    db
      .select({
        country: contributors.country,
        contributorCount: count(),
      })
      .from(contributors)
      .where(isNotNull(contributors.country))
      .groupBy(contributors.country),
  ]);

  const byCountry = new Map<string, CountryStat>();

  for (const row of repoRows) {
    if (!row.country) continue;
    byCountry.set(row.country, {
      country: row.country,
      repoCount: row.repoCount,
      totalStars: row.totalStars,
      contributorCount: 0,
    });
  }

  for (const row of contributorRows) {
    if (!row.country) continue;
    const existing = byCountry.get(row.country);
    if (existing) existing.contributorCount = row.contributorCount;
    else {
      byCountry.set(row.country, {
        country: row.country,
        repoCount: 0,
        totalStars: 0,
        contributorCount: row.contributorCount,
      });
    }
  }

  return [...byCountry.values()].sort(
    (a, b) => b.repoCount - a.repoCount || b.contributorCount - a.contributorCount,
  );
}

/**
 * The costliest of the four: two grouped scans, one of them over the whole
 * contributors table. It feeds a filter dropdown of ~200 countries that changes
 * about once a day.
 */
export const getCountryStats = memoize(loadCountryStats, AGGREGATE_TTL_MS);

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

export interface LanguageStat {
  language: string;
  repoCount: number;
  totalStars: number;
}

/**
 * Feeds the language filter dropdown. The values are returned verbatim so they
 * can be passed straight back as `?language=` and hit the btree index on an
 * exact match.
 */
async function loadLanguages(): Promise<LanguageStat[]> {
  const rows = await db
    .select({
      language: repositories.language,
      repoCount: count(),
      totalStars: sql<number>`coalesce(sum(${repositories.stars}), 0)`.mapWith(Number),
    })
    .from(repositories)
    .where(and(eq(repositories.status, 'active'), isNotNull(repositories.language)))
    .groupBy(repositories.language)
    .orderBy(desc(count()), repositories.language);

  return rows.flatMap((row) =>
    row.language
      ? [{ language: row.language, repoCount: row.repoCount, totalStars: row.totalStars }]
      : [],
  );
}

/** Options for the language dropdown — a grouped scan of every active repo. */
export const getLanguages = memoize(loadLanguages, AGGREGATE_TTL_MS);

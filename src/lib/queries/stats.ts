/**
 * Site-wide aggregates: the homepage header numbers, the geography view and the
 * language filter's options.
 *
 * All of these are cheap full-table aggregates over a few thousand rows. They
 * are written as plain grouped queries rather than materialised views because
 * the ingestion pipeline rewrites the whole repositories table on every sync,
 * and a view would need refreshing on exactly the same cadence for no gain.
 */

import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { categories, contributors, repositories, syncRuns } from '@/db/schema';

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

export async function getGlobalStats(): Promise<GlobalStats> {
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
export async function getCountryStats(): Promise<CountryStat[]> {
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
export async function getLanguages(): Promise<LanguageStat[]> {
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

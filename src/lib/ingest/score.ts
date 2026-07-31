/**
 * Score — recompute trend and quality for every active repository.
 *
 * Both scores are pure functions of already-fetched data (see @/lib/scoring),
 * so this stage makes no network calls at all: it reads, computes in JS, and
 * writes back in chunked bulk UPDATEs. That means it is safe to re-run at any
 * time, and it MUST be re-run after every snapshot, because the trend inputs
 * (starsDay/starsWeek) only exist once the snapshot job has diffed them.
 */

import { eq, sql } from 'drizzle-orm';

import { db, repositories } from '@/db';
import { computeQualityScore, computeTrendScore } from '@/lib/scoring';
import { chunk, daysAgoIso } from '@/lib/utils';

/** 6 bind params per row in the VALUES list; 1,000 rows = 6,000 params. */
const UPDATE_CHUNK = 1_000;

export interface ScoreOptions {
  /** Frozen "now" so a long run scores every repo against the same clock. */
  now?: Date;
  log?: (message: string) => void;
}

export interface ScoreStats extends Record<string, number | string> {
  scored: number;
  gradeA: number;
  gradeF: number;
  flagged: number;
}

interface ScoreRow {
  id: number;
  trendScore: number;
  trendVelocity: number;
  qualityScore: number;
  qualityGrade: string;
  qualityFlags: string[];
}

export async function score(options: ScoreOptions = {}): Promise<ScoreStats> {
  const log = options.log ?? ((message: string) => console.log(`  ${message}`));
  const now = options.now ?? new Date();

  const repos = await db
    .select({
      id: repositories.id,
      stars: repositories.stars,
      forks: repositories.forks,
      openIssues: repositories.openIssues,
      starsDay: repositories.starsDay,
      starsWeek: repositories.starsWeek,
      contributorsCount: repositories.contributorsCount,
      topContributorShare: repositories.topContributorShare,
      githubPushedAt: repositories.githubPushedAt,
      githubCreatedAt: repositories.githubCreatedAt,
      latestReleaseAt: repositories.latestReleaseAt,
      releasesLastYear: repositories.releasesLastYear,
      licenseSpdxId: repositories.licenseSpdxId,
      readmeLength: repositories.readmeLength,
      homepage: repositories.homepage,
      description: repositories.description,
      topics: repositories.topics,
      isArchived: repositories.isArchived,
      isFork: repositories.isFork,
    })
    .from(repositories)
    .where(eq(repositories.status, 'active'));

  log(`scoring ${repos.length} active repo(s)`);

  const contributorsWeekById = await contributorGrowth(now, repos);

  const rows: ScoreRow[] = [];
  const stats: ScoreStats = { scored: 0, gradeA: 0, gradeF: 0, flagged: 0 };

  for (const repo of repos) {
    const trend = computeTrendScore({
      stars: repo.stars,
      starsDay: repo.starsDay,
      starsWeek: repo.starsWeek,
      contributorsWeek: contributorsWeekById.get(repo.id) ?? 0,
      latestReleaseAt: repo.latestReleaseAt,
      pushedAt: repo.githubPushedAt,
      createdAt: repo.githubCreatedAt,
      isArchived: repo.isArchived,
      now,
    });

    const quality = computeQualityScore({
      stars: repo.stars,
      forks: repo.forks,
      openIssues: repo.openIssues,
      contributorsCount: repo.contributorsCount,
      topContributorShare: repo.topContributorShare,
      pushedAt: repo.githubPushedAt,
      createdAt: repo.githubCreatedAt,
      latestReleaseAt: repo.latestReleaseAt,
      releasesLastYear: repo.releasesLastYear,
      licenseSpdxId: repo.licenseSpdxId,
      readmeLength: repo.readmeLength,
      hasHomepage: Boolean(repo.homepage),
      hasDescription: Boolean(repo.description),
      topicsCount: repo.topics.length,
      isArchived: repo.isArchived,
      isFork: repo.isFork,
      now,
    });

    if (quality.grade === 'A') stats.gradeA++;
    if (quality.grade === 'F') stats.gradeF++;
    if (quality.flags.length > 0) stats.flagged++;

    rows.push({
      id: repo.id,
      trendScore: trend.score,
      trendVelocity: trend.velocity,
      qualityScore: quality.score,
      qualityGrade: quality.grade,
      qualityFlags: quality.flags,
    });
  }

  for (const batch of chunk(rows, UPDATE_CHUNK)) {
    // Every VALUES element carries an explicit cast: Postgres cannot infer a
    // type for a bare parameter inside VALUES and errors out rather than
    // guessing. jsonb in particular arrives as a text parameter.
    const values = sql.join(
      batch.map(
        (row) =>
          sql`(${row.id}::bigint, ${row.trendScore}::real, ${row.trendVelocity}::real, ${row.qualityScore}::integer, ${row.qualityGrade}::varchar, ${JSON.stringify(row.qualityFlags)}::jsonb)`,
      ),
      sql`, `,
    );

    await db.execute(sql`
      update repositories r
      set trend_score    = v.trend_score,
          trend_velocity = v.trend_velocity,
          quality_score  = v.quality_score,
          quality_grade  = v.quality_grade,
          quality_flags  = v.quality_flags
      from (values ${values}) as v(id, trend_score, trend_velocity, quality_score, quality_grade, quality_flags)
      where r.id = v.id
    `);

    stats.scored += batch.length;
  }

  log(`scored ${stats.scored} (A: ${stats.gradeA}, F: ${stats.gradeF})`);
  return stats;
}

/**
 * Contributors gained in the last ~7 days, from the snapshot history.
 *
 * A new contributor is a far rarer event than a star, which is why the trend
 * model weights it 10x — but it is only available once there are two snapshots
 * a week apart. Before then every repo scores 0 here, which is correct rather
 * than merely convenient.
 */
async function contributorGrowth(
  now: Date,
  current: readonly { id: number; contributorsCount: number | null }[],
): Promise<Map<number, number>> {
  const cutoff = daysAgoIso(7, now);

  // DISTINCT ON walks (repository_id, recorded_on DESC) once and stops at the
  // first row per repo — the same index the per-repo history chart uses.
  const result = await db.execute<{ repository_id: string; contributors_count: number | null }>(sql`
    select distinct on (m.repository_id)
      m.repository_id,
      m.contributors_count
    from repository_metrics m
    where m.recorded_on <= ${cutoff}::date
    order by m.repository_id, m.recorded_on desc
  `);

  const past = new Map<number, number>();
  for (const row of result.rows) {
    if (row.contributors_count === null) continue;
    // Raw SQL bypasses Drizzle's column mappers, and node-postgres hands back
    // int8 as a STRING to avoid precision loss. Number() is safe here: ids come
    // from a bigserial that will not pass 2^53 in this decade.
    past.set(Number(row.repository_id), row.contributors_count);
  }

  const growth = new Map<number, number>();
  for (const repo of current) {
    const before = past.get(repo.id);
    if (before === undefined || repo.contributorsCount === null) continue;
    growth.set(repo.id, Math.max(0, repo.contributorsCount - before));
  }
  return growth;
}

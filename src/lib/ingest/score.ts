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
  /**
   * How many rows the UPDATE actually touched. Almost always a small fraction of
   * `scored` — see the change filter in the UPDATE below.
   */
  changed: number;
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
      /**
       * Reduced in SQL rather than selected raw, because the scorer only ever
       * asks whether these are present or how many there are — it never reads
       * the values. Shipping the actual description text and topics array for
       * every active repo meant several megabytes crossing the network each
       * night to compute a boolean and a count. The database and the worker are
       * on different hosts, so that transfer is billable egress.
       *
       * `coalesce(x, '') <> ''` reproduces JS `Boolean(x)` exactly for the two
       * falsy cases a text column can hold, NULL and '', so the scores are
       * unchanged.
       */
      hasHomepage: sql<boolean>`coalesce(${repositories.homepage}, '') <> ''`,
      hasDescription: sql<boolean>`coalesce(${repositories.description}, '') <> ''`,
      topicsCount: sql<number>`coalesce(jsonb_array_length(${repositories.topics}), 0)`.mapWith(
        Number,
      ),
      isArchived: repositories.isArchived,
      isFork: repositories.isFork,
    })
    .from(repositories)
    .where(eq(repositories.status, 'active'));

  log(`scoring ${repos.length} active repo(s)`);

  const contributorsWeekById = await contributorGrowth(now, repos);

  const rows: ScoreRow[] = [];
  const stats: ScoreStats = { scored: 0, changed: 0, gradeA: 0, gradeF: 0, flagged: 0 };

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
      hasHomepage: repo.hasHomepage,
      hasDescription: repo.hasDescription,
      topicsCount: repo.topicsCount,
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

    /**
     * The `is distinct from` block is not an optimisation detail — it is what
     * keeps this stage inside a free-tier Disk IO budget.
     *
     * Without it this UPDATE rewrites every active row every day. Postgres has
     * no in-place update: each row gets a new version and the old one becomes
     * dead space. Two of the five columns written here are indexed (trend_score
     * by trend_idx, quality_score by quality_idx), which is enough to disqualify
     * the update from being a heap-only tuple — and a non-HOT update has to
     * insert a new index entry into EVERY index on the table, not just the ones
     * whose columns changed. `repositories` carries 16, two of them GIN. So the
     * unfiltered version cost ~30k row versions x 16 index writes, daily.
     *
     * Scores are stable for the overwhelming majority of repos on any given day:
     * quality moves only when maintenance signals change, and trend is 0 for
     * anything that gained no stars. Writing a value identical to the one
     * already stored costs exactly as much IO as a real change and buys nothing,
     * so filter those rows out in SQL rather than shipping them.
     *
     * `is distinct from` rather than `<>` because quality_score and
     * quality_grade are nullable: a NULL <> 5 comparison yields NULL, which
     * WHERE treats as false, so a never-scored repo would be skipped forever.
     */
    const result = await db.execute(sql`
      update repositories r
      set trend_score    = v.trend_score,
          trend_velocity = v.trend_velocity,
          quality_score  = v.quality_score,
          quality_grade  = v.quality_grade,
          quality_flags  = v.quality_flags
      from (values ${values}) as v(id, trend_score, trend_velocity, quality_score, quality_grade, quality_flags)
      where r.id = v.id
        and (
          r.trend_score    is distinct from v.trend_score
          or r.trend_velocity is distinct from v.trend_velocity
          or r.quality_score  is distinct from v.quality_score
          or r.quality_grade  is distinct from v.quality_grade
          or r.quality_flags  is distinct from v.quality_flags
        )
    `);

    stats.scored += batch.length;
    stats.changed += result.rowCount ?? 0;
  }

  log(
    `scored ${stats.scored}, wrote ${stats.changed} changed row(s) ` +
      `(A: ${stats.gradeA}, F: ${stats.gradeF})`,
  );
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

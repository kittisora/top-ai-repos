/**
 * Snapshot — record today's metrics, then recompute the growth deltas.
 *
 * GitHub only ever reports CURRENT values. There is no historical stars API and
 * the WatchEvent firehose that used to substitute for one has been throttled to
 * roughly 0.4% capture, so this table is the only place growth data can come
 * from — and it cannot be backfilled after the fact. A missed day is gone.
 *
 * CHANGE-ONLY STORAGE. Writing a row for every repo every day is ~95% waste:
 * measured over a real two-day window, only 4.5% of 29k repos moved at all, and
 * a full daily snapshot costs ~5.7 MB/day (≈170 MB/month, which overruns a
 * 500 MB database in weeks). So a row is written only when something actually
 * differs from the repo's most recent snapshot.
 *
 * That is safe because "no row" carries a precise meaning: the values did not
 * change since the last recorded row. Every read here asks for "the most recent
 * snapshot at or before date X", which therefore returns the correct value for
 * date X whether or not a row was written on it. The one thing this relies on is
 * the invariant that a change always produces a row — so if the job is skipped
 * for a day and values move, that movement is attributed to the next run. That
 * was already true of the old dense scheme.
 *
 * Everything is idempotent: re-running on the same UTC day updates the existing
 * row rather than duplicating or failing on the composite primary key.
 */

import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { daysAgoIso, isoDate } from '@/lib/utils';

export interface SnapshotOptions {
  /** UTC date key. Injectable so a backfill or a test can pin the day. */
  date?: string;
  /** Write a row for every active repo, not just the changed ones. */
  force?: boolean;
  log?: (message: string) => void;
}

export interface SnapshotStats extends Record<string, number | string> {
  date: string;
  rows: number;
  deltasUpdated: number;
}

export async function snapshot(options: SnapshotOptions = {}): Promise<SnapshotStats> {
  const log = options.log ?? ((message: string) => console.log(`  ${message}`));
  const today = options.date ?? isoDate();
  const force = options.force ?? false;

  /**
   * One statement, no round trips: compare each active repo against its own most
   * recent earlier snapshot and insert only where something moved. A repo with no
   * history at all always gets its baseline row (`prev.stars is null`).
   */
  const inserted = await db.execute(sql`
    insert into repository_metrics
      (repository_id, recorded_on, stars, forks, open_issues, watchers, contributors_count)
    select r.id, ${today}::date, r.stars, r.forks, r.open_issues, r.watchers, r.contributors_count
    from repositories r
    left join lateral (
      select m.stars, m.forks, m.open_issues, m.watchers, m.contributors_count
      from repository_metrics m
      where m.repository_id = r.id and m.recorded_on < ${today}::date
      order by m.recorded_on desc
      limit 1
    ) prev on true
    where r.status = 'active'
      and (
        ${force}
        or prev.stars is null
        or prev.stars <> r.stars
        or prev.forks <> r.forks
        or prev.open_issues <> r.open_issues
        or prev.watchers <> r.watchers
        or coalesce(prev.contributors_count, -1) <> coalesce(r.contributors_count, -1)
      )
    on conflict (repository_id, recorded_on) do update
      set stars = excluded.stars,
          forks = excluded.forks,
          open_issues = excluded.open_issues,
          watchers = excluded.watchers,
          contributors_count = excluded.contributors_count
  `);

  const written = inserted.rowCount ?? 0;
  log(`wrote ${written} changed metric row(s) for ${today}`);

  const deltasUpdated = await recomputeDeltas(today);
  log(`refreshed deltas on ${deltasUpdated} repo(s)`);

  return { date: today, rows: written, deltasUpdated };
}

/**
 * Recompute starsDay / starsWeek / starsMonth against the NEAREST snapshot at
 * least 1 / 7 / 30 days old.
 *
 * "Nearest at least N days old" rather than "exactly N days ago" is what makes
 * this survive both a missed run and the change-only storage above: the most
 * recent row at or before the cutoff holds the value that was current on that
 * date, whether or not a row was written that day.
 *
 * The current value comes from `repositories`, NOT from today's snapshot row —
 * with change-only storage most repos have no row today, and joining on one
 * would leave their deltas frozen at whatever they were the last time they moved.
 *
 * One statement, three LATERAL lookups. Each is a one-row backwards walk of
 * repository_metrics_repo_date_idx (repository_id, recorded_on DESC), which is
 * exactly what that index is shaped for.
 *
 * COALESCE to the repo's own value means "no history" yields a delta of 0 rather
 * than a fabricated number equal to the repo's entire star count.
 *
 * WRITE ONLY WHAT MOVED. The three-way `<>` filter at the end is what keeps this
 * off the free tier's Disk IO budget. Postgres cannot update a row in place: every
 * UPDATE writes a new row version, and because stars_day and stars_week are both
 * indexed the update is never HOT-eligible, so all 16 indexes on `repositories`
 * (two of them GIN) take a write per row. Unfiltered, this statement rewrote the
 * whole active table every single day — ~30k rows for the ~4.5% that actually
 * moved — which is also where most of the dead space that `db:vacuum` reclaims
 * came from. The deltas are NOT NULL with a default, and the right-hand
 * expressions are COALESCE-guarded, so plain `<>` cannot be tripped by a NULL.
 */
async function recomputeDeltas(today: string): Promise<number> {
  const from = new Date(`${today}T00:00:00Z`);

  // `src` exists because a LATERAL cannot reference the UPDATE's own target
  // alias; it joins straight back to `r` on the id.
  const real = await db.execute(sql`
    update repositories r
    set stars_day   = r.stars - coalesce(d1.stars,  r.stars),
        stars_week  = r.stars - coalesce(d7.stars,  r.stars),
        stars_month = r.stars - coalesce(d30.stars, r.stars)
    from repositories src
    left join lateral (
      select m.stars from repository_metrics m
      where m.repository_id = src.id and m.recorded_on <= ${daysAgoIso(1, from)}::date
      order by m.recorded_on desc limit 1
    ) d1 on true
    left join lateral (
      select m.stars from repository_metrics m
      where m.repository_id = src.id and m.recorded_on <= ${daysAgoIso(7, from)}::date
      order by m.recorded_on desc limit 1
    ) d7 on true
    left join lateral (
      select m.stars from repository_metrics m
      where m.repository_id = src.id and m.recorded_on <= ${daysAgoIso(30, from)}::date
      order by m.recorded_on desc limit 1
    ) d30 on true
    where r.id = src.id
      and r.status = 'active'
      and (
        r.stars_day   <> r.stars - coalesce(d1.stars,  r.stars)
        or r.stars_week  <> r.stars - coalesce(d7.stars,  r.stars)
        or r.stars_month <> r.stars - coalesce(d30.stars, r.stars)
      )
  `);

  return real.rowCount ?? 0;
}

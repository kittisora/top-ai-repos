/**
 * Metrics — refresh the volatile counters for EVERY active repo, cheaply.
 *
 * `sync` is the deep-enrichment rotation: READMEs, releases, contributors, owner
 * location, rename and lifecycle handling. That work is expensive enough that one
 * run only reaches ~1,500 repos, so across 24.5k active repos a full rotation
 * takes eight days — and `snapshot`, which copies `repositories.stars` into
 * `repository_metrics`, was therefore recording a number that could be eight days
 * old. The history that came out of it is a step function: flat for a week, then
 * one jump. langgenius/dify had four rows in twenty days, 94.6% of active repos
 * showed stars_day = 0, and that included all twelve of the biggest repos in the
 * index — i.e. the "is this moving right now" signal the product leads with was
 * dead for almost everything.
 *
 * The fix is not in snapshot. Snapshot's change-only storage is correct and its
 * deltas are computed correctly; it was simply being fed a stale input. So this
 * stage exists to make that input fresh, and it does exactly one thing: read four
 * integers for all 24.5k repos and write them.
 *
 *   stars, forks, open_issues, watchers
 *
 * It is affordable because of WHAT it asks for, not just how much. The counters
 * ride a dedicated GraphQL fragment (RepoMetrics) carrying six fields and no
 * connections, so 50 repos resolve in ~2.2s for 1 point where the full metadata
 * fragment took 8.5-10s and routinely blew the client's 9s timeout. The whole
 * table is therefore ~491 queries and ~491 points per run: under 10% of the
 * 5,000-points/hour GraphQL budget, and no core REST quota at all. Measured
 * end to end at ~16 minutes for 24.5k repos (3,000 in 120s on 2026-08-17),
 * which the ingest unit's 3h timeout swallows without noticing. That is what
 * makes a full sweep viable twice a day where the deep sync can only afford a
 * rotation.
 *
 * What this stage deliberately does NOT do matters as much as what it does: it
 * never writes last_synced_at (that column is sync's work queue watermark) and
 * never rejects a repo it failed to fetch (that is sync's decision, and it needs
 * an authoritative REST lookup to make it). Both are spelled out below.
 */

import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';

import { db, repositories } from '@/db';
import { github } from '@/lib/github';
import type { RepoMetrics } from '@/lib/github';
import { chunk } from '@/lib/utils';

/**
 * How many repos one GraphQL call group covers. The client chunks internally at
 * 50 and runs those batches concurrently, so this outer grouping is not what
 * sizes the queries — it only bounds the blast radius of a non-recoverable
 * error, exactly as in sync. A thrown group costs 500 repos their freshness for
 * this run instead of ending the sweep.
 */
const GRAPH_GROUP = 500;

/** 5 bind params per row in the VALUES list; 1,000 rows = 5,000 params. */
const UPDATE_CHUNK = 1_000;

export interface RefreshMetricsOptions {
  /** Cap on repos swept, for testing and manual runs. Default: every one. */
  limit?: number;
  log?: (message: string) => void;
}

export interface RefreshMetricsStats extends Record<string, number | string> {
  queued: number;
  fetched: number;
  updated: number;
  missing: number;
  errors: number;
}

interface QueuedRepo {
  id: number;
  githubId: number;
  nodeId: string;
}

/** The entire write surface of this stage. */
interface MetricRow {
  id: number;
  stars: number;
  forks: number;
  openIssues: number;
  watchers: number;
}

export async function refreshMetrics(
  options: RefreshMetricsOptions = {},
): Promise<RefreshMetricsStats> {
  const log = options.log ?? ((message: string) => console.log(`  ${message}`));
  const limit = options.limit ?? 0;

  const stats: RefreshMetricsStats = {
    queued: 0,
    fetched: 0,
    updated: 0,
    missing: 0,
    errors: 0,
  };

  /**
   * Ordered by id, NOT by last_synced_at. Sync orders that way because it is
   * working a rotation and has to pick up where it left off; this is a full
   * sweep of every active repo, so there is no queue position to preserve and
   * nothing to prioritise. A stable key just means a deliberately truncated run
   * (--metrics-limit) covers the same repos each time instead of a moving
   * sample, which is what you want while testing.
   *
   * The node_id guard is defensive rather than load-bearing — every active row
   * has one today — but a null in the `nodes(ids: [...])` argument poisons the
   * whole batch, so a repo missing it is skipped and left for sync.
   */
  const queued = db
    .select({
      id: repositories.id,
      githubId: repositories.githubId,
      nodeId: repositories.nodeId,
    })
    .from(repositories)
    .where(and(eq(repositories.status, 'active'), isNotNull(repositories.nodeId)))
    .orderBy(asc(repositories.id));

  const rows = limit > 0 ? await queued.limit(limit) : await queued;
  const queue: QueuedRepo[] = rows.filter((row): row is QueuedRepo => row.nodeId !== null);

  stats.queued = queue.length;
  if (queue.length === 0) {
    log('nothing to refresh');
    return stats;
  }
  log(`queued ${queue.length} repo(s)`);

  const updates: MetricRow[] = [];

  for (const group of chunk(queue, GRAPH_GROUP)) {
    let fetched: RepoMetrics[] = [];
    try {
      /**
       * Queried by node id, not by "owner/name". Node ids are immune to
       * renames, so a repo that moved since its last sync still resolves here
       * and still gets a fresh star count under whatever name we have stored —
       * no rename bookkeeping, no fullName collisions to resolve, none of which
       * this stage is allowed to write anyway. Sync fixes the name on its next
       * pass.
       */
      fetched = await github.getRepoMetricsByNodeIds(group.map((row) => row.nodeId));
    } catch (error) {
      stats.errors++;
      log(`graphql group failed (${group.length} repos): ${describe(error)}`);
      continue;
    }

    /**
     * Re-key on the NUMERIC id, never on the node id we sent, and never by
     * position.
     *
     * The node id is fine as a query ARGUMENT but useless as a join key,
     * because the id we send is not the id we get back. The client sets
     * `X-Github-Next-Global-ID: 1`, which makes GitHub answer with the modern
     * `R_kgDO…` form for every id field regardless of which form was queried;
     * 3,087 of our 24.5k active rows (12.6%) are still stored under the legacy
     * base64 `MDEw…` form, because `discover` re-writes REST's legacy id on
     * every run, one stage before this one. Keying the response map on
     * `nodeId` therefore missed every one of those repos: they were fetched,
     * silently dropped, and miscounted as `missing` — and they are precisely
     * the oldest, highest-star repos in the index (tensorflow/tensorflow,
     * huggingface/transformers, scikit-learn; 1,018 of them above 1,000 stars),
     * i.e. exactly the ones whose star history this stage exists to un-freeze.
     *
     * `databaseId` survives both the global-id migration and renames, and it is
     * what sync already keys on for the same reason. The node-id map is kept
     * only as a fallback for the case GitHub's schema technically allows —
     * `databaseId` coming back null — and is consulted second so it can never
     * override a numeric-id match.
     *
     * Position is not an option: `nodes(ids:)` does answer in input order, but
     * the client filters out nulls for repos that no longer resolve and
     * contributes nothing at all for a batch it gave up on, so the result array
     * is shorter than the input whenever anything went missing. Zipping would
     * write one repo's star count onto another's row.
     */
    const byGithubId = new Map<number, RepoMetrics>();
    const byNodeId = new Map<string, RepoMetrics>();
    for (const repo of fetched) {
      if (repo.githubId !== null) byGithubId.set(repo.githubId, repo);
      byNodeId.set(repo.nodeId, repo);
    }

    for (const row of group) {
      const repo = byGithubId.get(row.githubId) ?? byNodeId.get(row.nodeId);
      if (!repo) continue;
      updates.push({
        id: row.id,
        stars: repo.stars,
        forks: repo.forks,
        openIssues: repo.openIssues,
        watchers: repo.watchers,
      });
    }

    stats.fetched = updates.length;
    log(`graphql: ${fetched.length}/${group.length} resolved (${updates.length} total)`);
  }

  /**
   * Everything that did not come back is counted and then left completely
   * alone. A GraphQL miss is ambiguous — deleted, gone private, DMCA'd, or a
   * batch the client abandoned after halving it twice — and only an
   * authoritative REST lookup separates those. `sync` already performs that
   * lookup and owns the 404/410/451 → `rejected` transition; a weaker copy of
   * that decision here would deactivate live repositories on any afternoon
   * GitHub's GraphQL endpoint is unhappy, and this stage runs over the entire
   * table, so it would do it at scale.
   */
  stats.missing = stats.queued - stats.fetched;

  /**
   * THE ONE COLUMN THIS STAGE MUST NEVER WRITE IS last_synced_at.
   *
   * It is not a "when did we last look at this repo" timestamp — it is the work
   * queue watermark. `sync` picks its next 1,500 repos with
   * `order by last_synced_at asc nulls first` over
   * repositories_sync_queue_idx (status, last_synced_at). Stamping now() on all
   * 24.5k rows here would collapse that ordering to a single value: the deep
   * enrichment rotation would degenerate into whatever order the index happens
   * to return, repos would be re-enriched at random while others were never
   * reached, and the eight-day cycle this stage was written to compensate for
   * would become unbounded. The rotation has to advance on sync's clock alone.
   *
   * Which is also why `set` lists four columns and stops. No etag (this path
   * sends no conditional request, so there is no fresh one to store), no
   * derived star deltas (snapshot owns those and runs immediately after), no
   * metadata of any kind.
   *
   * CHANGE-ONLY WRITES. The `<>` block is not a micro-optimisation; it is what
   * makes sweeping the whole table affordable. Postgres cannot update a row in
   * place: every UPDATE writes a new row version and leaves the old one as dead
   * space. `stars` is indexed (repositories_stars_idx, with stars_day and
   * stars_week beside it), which disqualifies the write from being a heap-only
   * tuple, and a non-HOT update inserts an entry into EVERY one of the 16
   * indexes on `repositories`, two of them GIN. Unfiltered, this stage would
   * rewrite 24.5k rows x 16 index entries twice a day on behalf of the ~5% of
   * repos that actually moved, which is precisely the dead space `db:vacuum`
   * exists to reclaim.
   *
   * The comparison is done in SQL rather than in JS because the queue carries
   * only (id, node_id) on purpose: reading four more columns for 24.5k rows to
   * filter client-side would cost more than it saves, and testing inside the
   * statement compares against the value at write time rather than one read
   * minutes and several thousand GraphQL calls earlier. All four columns are
   * NOT NULL with defaults, so plain `<>` cannot be silently defeated by a NULL
   * the way it could in score's `is distinct from` case.
   *
   * The `status = 'active'` re-check costs nothing and covers the gap between
   * building the queue and writing it — sync may have rejected a repo in
   * between, and a rejected repo must not be quietly revived with fresh counts.
   */
  for (const batch of chunk(updates, UPDATE_CHUNK)) {
    // Every VALUES element carries an explicit cast: Postgres cannot infer a
    // type for a bare parameter inside VALUES and errors out rather than
    // guessing.
    const values = sql.join(
      batch.map(
        (row) =>
          sql`(${row.id}::bigint, ${row.stars}::int, ${row.forks}::int, ${row.openIssues}::int, ${row.watchers}::int)`,
      ),
      sql`, `,
    );

    const result = await db.execute(sql`
      update repositories r
      set stars       = v.stars,
          forks       = v.forks,
          open_issues = v.open_issues,
          watchers    = v.watchers
      from (values ${values}) as v(id, stars, forks, open_issues, watchers)
      where r.id = v.id
        and r.status = 'active'
        and (
          r.stars <> v.stars
          or r.forks <> v.forks
          or r.open_issues <> v.open_issues
          or r.watchers <> v.watchers
        )
    `);

    stats.updated += result.rowCount ?? 0;
  }

  log(
    `fetched ${stats.fetched}, updated ${stats.updated}, ` +
      `missing ${stats.missing}, errors ${stats.errors}`,
  );

  /**
   * A sweep that fetched NOTHING is a failure, even though every group was
   * caught and counted.
   *
   * The catch above is per-group so one bad batch cannot cost the run, but that
   * same tolerance makes a total outage look like success: fetchBatchIsolated
   * rethrows 401/403 rather than degrading, so after a token rotation or a
   * scope change every group in turn lands in the catch and the function
   * returns normally with fetched: 0. withRun would then record status 'ok',
   * ingest would exit 0, and the scheduler would see green — while snapshot,
   * running seconds later, wrote a full day of table-wide stale counters. That
   * is the exact failure this stage exists to prevent, and it must not be
   * silent.
   *
   * Throwing here does NOT endanger snapshot: the stage loop in
   * scripts/ingest.ts wraps each stage in its own try/catch, records the name
   * in `failures`, and carries on to the next stage, deferring the non-zero
   * exit to the end of the run. The irrecoverable stage still runs.
   */
  if (stats.errors > 0 && stats.fetched === 0) {
    throw new Error(
      `metrics sweep refreshed nothing: ${stats.errors} group(s) failed across ` +
        `${stats.queued} queued repo(s)`,
    );
  }

  return stats;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

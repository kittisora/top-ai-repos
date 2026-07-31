/**
 * Discovery — find AI repositories we have never seen.
 *
 * The whole design exists to beat one number: `/search/repositories` returns at
 * most 1,000 results per query string, no matter what `total_count` says.
 * `total_count` itself is NOT capped, which is the only reason a splitter can
 * work — we read it to decide whether the shard we just asked for is honest.
 *
 * Two sharding axes, and both are mandatory:
 *
 *   axis 1  stars:lo..hi   recursive bisection, geometric midpoint (star counts
 *                          are power-law distributed; an arithmetic midpoint
 *                          puts 99% of repos in the lower half every time).
 *   axis 2  created:a..b   the fallback for when lo === hi and there are still
 *                          >1,000 results — routine in the low star bands, where
 *                          no star range can split any further.
 *
 * The date bisection is FLOORED AT A ONE-DAY WINDOW. Without that floor the
 * midpoint of a one-day range collapses onto the start date, the child shard is
 * identical to its parent, and the recursion never terminates.
 *
 * The other big idea here is negative: search `items[]` are FULL repository
 * objects — topics, license, owner, counts, all three timestamps. One
 * `per_page=100` search yields 100 fully-enriched repos, so discovery never
 * follows up with /repos/{o}/{r}, /topics or /license. That single fact is the
 * difference between ~1,000 requests for a sweep and ~100,000.
 */

import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import { db, discoveryShards, repositories } from '@/db';
import { env } from '@/lib/env';
import { github } from '@/lib/github';
import type { SearchRepoItem } from '@/lib/github';
import { ALL_TOPICS, DISCOVERY_PHRASES } from '@/lib/taxonomy';
import { chunk, isoDate } from '@/lib/utils';
import { parseDate, releaseConflictingFullNames, REPO_INSERT_CHUNK } from './repos';

/** GitHub itself launched in 2008; nothing predates this. */
const GITHUB_EPOCH = '2008-01-01';

/** Above any real repository — the top of the internet is ~450k stars. */
const STAR_CEILING = 1_000_000;

/** The hard per-query result wall. Not configurable, not negotiable. */
const SEARCH_RESULT_CAP = 1_000;

const PER_PAGE = 100;

const DAY_MS = 86_400_000;

export interface DiscoverOptions {
  /** Defaults to every curated topic slug in the taxonomy. */
  topics?: readonly string[];
  /**
   * Free-text phrases matched against name+description, for the repos topic
   * search structurally cannot reach (those with no topics, or topics nobody
   * would think to seed). Defaults to DISCOVERY_PHRASES; pass [] to skip.
   */
  phrases?: readonly string[];
  /** Lower bound of the created: axis. Set to yesterday for an incremental run. */
  createdFrom?: string;
  /** Upper bound of the created: axis. Defaults to today (UTC). */
  createdTo?: string;
  /**
   * Wall-clock brake. Search is serialized at 2.1s spacing, so 1,200 calls is
   * roughly 42 minutes — about one full sweep.
   */
  maxSearches?: number;
  /** Repo budget for this run. Defaults to env.discoveryLimit; 0 = unlimited. */
  limit?: number;
  log?: (message: string) => void;
}

export interface DiscoverStats extends Record<string, number | string> {
  /** Topic slugs swept. */
  topics: number;
  /** Free-text phrases swept — the topic-independent half. */
  phrases: number;
  searches: number;
  shardsCompleted: number;
  shardsSplit: number;
  shardsUnsplittable: number;
  reposSeen: number;
  reposInserted: number;
  reposUpdated: number;
  namesReleased: number;
  errors: number;
}

interface Shard {
  topic: string;
  starsLo: number;
  starsHi: number;
  createdFrom: string;
  createdTo: string;
}

function shardKey(shard: Shard): string {
  return `${shard.topic}|${shard.starsLo}|${shard.starsHi}|${shard.createdFrom}|${shard.createdTo}`;
}

/**
 * Free-text seeds are stored with a `q:` prefix so one column, one unique index
 * and one resumable queue serve both discovery modes without a migration.
 */
const PHRASE_PREFIX = 'q:';

export function phraseSeed(phrase: string): string {
  return `${PHRASE_PREFIX}${phrase}`;
}

function buildQuery(shard: Shard): string {
  // A `q:`-prefixed seed is a phrase matched against the name and description;
  // anything else is a GitHub topic slug. Restricting to name+description is what
  // keeps phrase search precise — the default would also match READMEs, where a
  // passing mention of "ai agent" says nothing about what the repo is.
  const matcher = shard.topic.startsWith(PHRASE_PREFIX)
    ? `"${shard.topic.slice(PHRASE_PREFIX.length)}" in:name,description`
    : `topic:${shard.topic}`;

  // No boolean operators at all, so the ≤5-operator limit cannot bite, and the
  // string stays far below the 256-character ceiling.
  return [
    matcher,
    'is:public',
    'archived:false',
    'fork:false',
    `stars:${shard.starsLo}..${shard.starsHi}`,
    `created:${shard.createdFrom}..${shard.createdTo}`,
  ].join(' ');
}

/**
 * Split a shard, stars first. Returns [] when the shard is atomic — a single
 * star value inside a single day — which is the only case where we knowingly
 * accept the first 1,000 results and move on.
 */
export function splitShard(shard: Shard): Shard[] {
  if (shard.starsHi > shard.starsLo) {
    // Geometric, not arithmetic: between 50 and 1,000,000 stars the arithmetic
    // midpoint is 500,025, which leaves essentially every repo in the lower
    // half and turns bisection into linear scanning.
    const geometric = Math.floor(Math.sqrt(Math.max(1, shard.starsLo) * shard.starsHi));
    const mid = Math.min(Math.max(geometric, shard.starsLo), shard.starsHi - 1);
    return [
      { ...shard, starsLo: shard.starsLo, starsHi: mid },
      { ...shard, starsLo: mid + 1, starsHi: shard.starsHi },
    ];
  }

  const fromMs = Date.parse(`${shard.createdFrom}T00:00:00Z`);
  const toMs = Date.parse(`${shard.createdTo}T00:00:00Z`);
  const spanDays = Math.round((toMs - fromMs) / DAY_MS);

  // THE INFINITE-LOOP GUARD. At spanDays === 0 the midpoint is the start date
  // and the first child is byte-identical to its parent.
  if (spanDays < 1) return [];

  const midMs = fromMs + Math.floor(spanDays / 2) * DAY_MS;
  const mid = isoDate(new Date(midMs));
  const nextDay = isoDate(new Date(midMs + DAY_MS));

  return [
    { ...shard, createdFrom: shard.createdFrom, createdTo: mid },
    { ...shard, createdFrom: nextDay, createdTo: shard.createdTo },
  ];
}

/** Map a search item onto an insertable repositories row. */
function toRepositoryRow(item: SearchRepoItem, source: string) {
  return {
    githubId: item.id,
    nodeId: item.node_id,
    fullName: item.full_name,
    ownerLogin: item.owner.login,
    name: item.name,
    description: item.description,
    homepage: item.homepage,
    language: item.language,
    topics: item.topics,
    licenseSpdxId: item.license?.spdx_id ?? null,
    licenseName: item.license?.name ?? null,
    stars: item.stargazers_count,
    forks: item.forks_count,
    openIssues: item.open_issues_count,
    watchers: item.watchers_count,
    sizeKb: item.size,
    defaultBranch: item.default_branch,
    isFork: item.fork,
    isArchived: item.archived,
    isTemplate: item.is_template,
    ownerType: item.owner.type,
    ownerAvatarUrl: item.owner.avatar_url,
    githubCreatedAt: parseDate(item.created_at),
    githubPushedAt: parseDate(item.pushed_at),
    githubUpdatedAt: parseDate(item.updated_at),
    discoverySource: source,
  };
}

/**
 * Upsert on the numeric GitHub id — the only identifier stable across renames.
 *
 * `discoverySource` and `firstSeenAt` are deliberately absent from `set`: they
 * describe how and when we FIRST met the repo, so they must survive every
 * later re-discovery. `status` is absent for the same reason — a repo we
 * rejected must not be silently resurrected by the next sweep.
 */
export async function upsertDiscovered(
  items: readonly SearchRepoItem[],
  source: string,
): Promise<{ inserted: number; updated: number; released: number }> {
  const rows = items.map((item) => toRepositoryRow(item, source));
  if (rows.length === 0) return { inserted: 0, updated: 0, released: 0 };

  const released = await releaseConflictingFullNames(rows);

  let inserted = 0;
  let updated = 0;

  for (const batch of chunk(rows, REPO_INSERT_CHUNK)) {
    const result = await db
      .insert(repositories)
      .values(batch)
      .onConflictDoUpdate({
        target: repositories.githubId,
        set: {
          nodeId: sql`excluded.node_id`,
          fullName: sql`excluded.full_name`,
          ownerLogin: sql`excluded.owner_login`,
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          homepage: sql`excluded.homepage`,
          language: sql`excluded.language`,
          topics: sql`excluded.topics`,
          licenseSpdxId: sql`excluded.license_spdx_id`,
          licenseName: sql`excluded.license_name`,
          stars: sql`excluded.stars`,
          forks: sql`excluded.forks`,
          openIssues: sql`excluded.open_issues`,
          watchers: sql`excluded.watchers`,
          sizeKb: sql`excluded.size_kb`,
          defaultBranch: sql`excluded.default_branch`,
          isFork: sql`excluded.is_fork`,
          isArchived: sql`excluded.is_archived`,
          isTemplate: sql`excluded.is_template`,
          ownerType: sql`excluded.owner_type`,
          ownerAvatarUrl: sql`excluded.owner_avatar_url`,
          githubCreatedAt: sql`excluded.github_created_at`,
          githubPushedAt: sql`excluded.github_pushed_at`,
          githubUpdatedAt: sql`excluded.github_updated_at`,
        },
      })
      // `xmax = 0` is the standard way to tell an INSERT apart from an ON
      // CONFLICT UPDATE in the same RETURNING clause: a freshly inserted tuple
      // has no updating transaction id.
      .returning({ isNew: sql<boolean>`(xmax = 0)` });

    for (const row of result) {
      if (row.isNew) inserted++;
      else updated++;
    }
  }

  return { inserted, updated, released };
}

export async function discover(options: DiscoverOptions = {}): Promise<DiscoverStats> {
  const log = options.log ?? ((message: string) => console.log(`  ${message}`));
  /**
   * One queue for both modes: topic slugs and `q:`-prefixed phrases. They shard,
   * resume and dedupe identically, so the only difference is how buildQuery turns
   * a seed into a GitHub query.
   */
  const topicSeeds = [...(options.topics ?? ALL_TOPICS)];
  const phraseSeeds = (options.phrases ?? DISCOVERY_PHRASES).map(phraseSeed);
  const topics = [...topicSeeds, ...phraseSeeds];
  const createdFrom = options.createdFrom ?? GITHUB_EPOCH;
  const createdTo = options.createdTo ?? isoDate();
  const maxSearches = options.maxSearches ?? 1_200;
  const repoLimit = options.limit ?? env.discoveryLimit;
  const minStars = env.minStars;

  const stats: DiscoverStats = {
    topics: topicSeeds.length,
    phrases: phraseSeeds.length,
    searches: 0,
    shardsCompleted: 0,
    shardsSplit: 0,
    shardsUnsplittable: 0,
    reposSeen: 0,
    reposInserted: 0,
    reposUpdated: 0,
    namesReleased: 0,
    errors: 0,
  };

  // ---------------------------------------------------------------- resume --
  // Anything still pending (or that errored last time) is the work list. Shards
  // marked 'done' or 'split' are settled: a split parent's children were written
  // in the same transaction that marked it, so they are already in this query.
  //
  // The star floor is part of the filter, not just of new roots. Shards left
  // pending under a LOWER floor belong to a different sweep: resuming them would
  // quietly re-harvest the long tail that raising MIN_STARS was meant to exclude,
  // and the operator would see the index grow again with no idea why.
  const pending = await db
    .select()
    .from(discoveryShards)
    .where(
      and(
        inArray(discoveryShards.topic, topics),
        inArray(discoveryShards.status, ['pending', 'error']),
        gte(discoveryShards.starsLo, minStars),
      ),
    );

  const queue: Shard[] = pending.map((row) => ({
    topic: row.topic,
    starsLo: row.starsLo,
    starsHi: row.starsHi,
    createdFrom: row.createdFrom ?? createdFrom,
    createdTo: row.createdTo ?? createdTo,
  }));

  // Seed a root shard for every topic that has no root row for this window yet.
  const roots = await db
    .select({ topic: discoveryShards.topic })
    .from(discoveryShards)
    .where(
      and(
        inArray(discoveryShards.topic, topics),
        eq(discoveryShards.starsLo, minStars),
        eq(discoveryShards.starsHi, STAR_CEILING),
        eq(discoveryShards.createdFrom, createdFrom),
        eq(discoveryShards.createdTo, createdTo),
      ),
    );
  const rooted = new Set(roots.map((row) => row.topic));

  for (const topic of topics) {
    if (rooted.has(topic)) continue;
    queue.push({ topic, starsLo: minStars, starsHi: STAR_CEILING, createdFrom, createdTo });
  }

  if (pending.length > 0) {
    log(`resuming ${pending.length} unfinished shard(s)`);
  }
  log(
    `${queue.length} shard(s) queued across ${topicSeeds.length} topic(s) ` +
      `and ${phraseSeeds.length} phrase(s)`,
  );

  // Shards overlap (a repo carries many topics, and star bands are re-walked),
  // so dedupe within the run before spending an upsert on the same row twice.
  const seen = new Set<number>();
  const visited = new Set<string>();

  while (queue.length > 0) {
    if (stats.searches >= maxSearches) {
      log(`search budget of ${maxSearches} reached — ${queue.length} shard(s) left for next run`);
      break;
    }
    if (repoLimit > 0 && seen.size >= repoLimit) {
      log(`repo limit of ${repoLimit} reached — ${queue.length} shard(s) left for next run`);
      break;
    }

    const shard = queue.pop()!;
    const key = shardKey(shard);
    if (visited.has(key)) continue;
    visited.add(key);

    await recordShard(shard, { status: 'pending' });

    try {
      const query = buildQuery(shard);
      stats.searches++;
      const first = await github.searchRepositories(query, { perPage: PER_PAGE, page: 1 });

      const collected: SearchRepoItem[] = [...first.items];

      // `capped` on page 1 should be impossible, but treat it exactly like an
      // over-cap total: it means the shard is too wide to enumerate.
      const overCap = first.capped || first.totalCount > SEARCH_RESULT_CAP;
      // incomplete_results means GitHub timed out and returned PARTIAL matches.
      // The payload looks completely valid; ignoring it silently loses repos.
      const needsNarrowing = overCap || first.incompleteResults;

      if (needsNarrowing) {
        const children = splitShard(shard);

        if (children.length > 0) {
          await db.transaction(async (tx) => {
            await recordShard(shard, {
              status: 'split',
              totalCount: first.totalCount,
              fetched: collected.length,
              completedAt: new Date(),
            }, tx);
            for (const child of children) {
              await recordShard(child, { status: 'pending' }, tx);
            }
          });
          queue.push(...children);
          stats.shardsSplit++;
        } else {
          // A single star value inside a single day with >1,000 results. No
          // axis can split further; take the 1,000 we are allowed and record
          // the shortfall so it is auditable rather than invisible.
          const reachable = Math.min(first.totalCount, SEARCH_RESULT_CAP);
          collected.push(...(await paginate(shard, reachable, stats)));
          await recordShard(shard, {
            status: 'done',
            totalCount: first.totalCount,
            fetched: collected.length,
            error: `unsplittable: ${first.totalCount} results, only ${collected.length} reachable`,
            completedAt: new Date(),
          });
          stats.shardsUnsplittable++;
          stats.shardsCompleted++;
        }
      } else {
        collected.push(...(await paginate(shard, first.totalCount, stats)));
        await recordShard(shard, {
          status: 'done',
          totalCount: first.totalCount,
          fetched: collected.length,
          completedAt: new Date(),
        });
        stats.shardsCompleted++;
      }

      // Page-1 items are real repos even when the shard has to split, so they
      // are always worth writing — the child shards will simply re-see them.
      const fresh = collected.filter((item) => {
        if (item.id === 0 || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });

      if (fresh.length > 0) {
        // Label the seed honestly: "phrase:agentic", not "topic:q:agentic".
        const source = shard.topic.startsWith(PHRASE_PREFIX)
          ? `phrase:${shard.topic.slice(PHRASE_PREFIX.length)}`
          : `topic:${shard.topic}`;
        const written = await upsertDiscovered(fresh, source);
        stats.reposInserted += written.inserted;
        stats.reposUpdated += written.updated;
        stats.namesReleased += written.released;
        stats.reposSeen = seen.size;
        log(
          `${shard.topic} stars:${shard.starsLo}..${shard.starsHi} ` +
            `created:${shard.createdFrom}..${shard.createdTo} — ` +
            `total ${first.totalCount}, +${written.inserted} new / ${written.updated} updated ` +
            `(${seen.size} seen, ${stats.searches} searches)`,
        );
      }
    } catch (error) {
      stats.errors++;
      const message = error instanceof Error ? error.message : String(error);
      // One bad shard must never abort the sweep; it is recorded and re-queued
      // automatically on the next run because 'error' rows are resumable.
      await recordShard(shard, {
        status: 'error',
        error: message.slice(0, 2_000),
        completedAt: new Date(),
      }).catch(() => undefined);
      log(`ERROR ${shardKey(shard)}: ${message}`);
    }
  }

  stats.reposSeen = seen.size;
  return stats;
}

/**
 * Fetch pages 2..N for a shard we have already decided is enumerable. Page 1 is
 * always already spent by the caller, which is why this starts at 2.
 */
async function paginate(
  shard: Shard,
  totalCount: number,
  stats: DiscoverStats,
): Promise<SearchRepoItem[]> {
  const items: SearchRepoItem[] = [];
  const reachable = Math.min(totalCount, SEARCH_RESULT_CAP);
  const pages = Math.ceil(reachable / PER_PAGE);
  const query = buildQuery(shard);

  for (let page = 2; page <= pages; page++) {
    stats.searches++;
    const result = await github.searchRepositories(query, { perPage: PER_PAGE, page });
    // Page 11+ is the 422 wall. `pages` can never exceed 10 here, but a shard
    // whose total_count shifted mid-crawl can still trip it — stop, don't throw.
    if (result.capped) break;
    if (result.items.length === 0) break;
    items.push(...result.items);
  }

  return items;
}

type ShardPatch = Partial<{
  status: string;
  totalCount: number;
  fetched: number;
  error: string;
  completedAt: Date;
}>;

/**
 * Upsert one shard row. The unique index spans (topic, stars_lo, stars_hi,
 * created_from, created_to) and NULLs in a Postgres unique index do not
 * conflict with each other — which is exactly why both date columns are always
 * written, never left null.
 */
/**
 * Structural, not nominal: a Drizzle transaction is NOT assignable to the
 * database type (it has no `$client`), so the narrowest thing both satisfy is
 * "has an insert method".
 */
type Inserter = Pick<typeof db, 'insert'>;

async function recordShard(
  shard: Shard,
  patch: ShardPatch,
  tx: Inserter = db,
): Promise<void> {
  await tx
    .insert(discoveryShards)
    .values({
      topic: shard.topic,
      starsLo: shard.starsLo,
      starsHi: shard.starsHi,
      createdFrom: shard.createdFrom,
      createdTo: shard.createdTo,
      status: patch.status ?? 'pending',
      totalCount: patch.totalCount ?? null,
      fetched: patch.fetched ?? 0,
      error: patch.error ?? null,
      completedAt: patch.completedAt ?? null,
    })
    .onConflictDoUpdate({
      target: [
        discoveryShards.topic,
        discoveryShards.starsLo,
        discoveryShards.starsHi,
        discoveryShards.createdFrom,
        discoveryShards.createdTo,
      ],
      set: {
        status: sql`excluded.status`,
        totalCount: sql`coalesce(excluded.total_count, discovery_shards.total_count)`,
        fetched: sql`greatest(excluded.fetched, discovery_shards.fetched)`,
        error: sql`excluded.error`,
        completedAt: sql`excluded.completed_at`,
      },
    });
}

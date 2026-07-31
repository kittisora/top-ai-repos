/**
 * Sync — refresh metadata for repositories we already know about.
 *
 * GraphQL does the heavy lifting: one aliased query pulls 20 fully-populated
 * repositories, which is roughly 20x cheaper in wall-clock terms than the REST
 * equivalent and costs almost nothing against the 5,000-points/hour budget.
 *
 * Three things make this harder than "fetch and write":
 *
 *   1. The bulk methods return ONLY repos that resolved. Null aliases are
 *      dropped, so the result array is shorter than the input and must be
 *      re-keyed on githubId/fullName — never zipped positionally.
 *   2. `repository(owner:name:)` follows renames, so a repo can come back under
 *      a different fullName than the one we asked for. That name may already be
 *      taken in our table by another row.
 *   3. Anything that does not come back at all is ambiguous: deleted, made
 *      private, DMCA'd, or simply a transient GraphQL error. Only a REST lookup
 *      can tell those apart, and only a 404/410/451 justifies rejecting a repo.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, repositories } from '@/db';
import { github } from '@/lib/github';
import type { GraphRepo, SearchRepoItem } from '@/lib/github';
import { chunk, mapLimit } from '@/lib/utils';
import { parseDate, releaseConflictingFullNames, REPO_INSERT_CHUNK } from './repos';

/** Enough of the README to classify and preview; not enough to mirror the repo. */
/**
 * How much README text is kept.
 *
 * 4,000 rather than 8,000 because that is exactly what the rule classifier reads
 * (`classify` truncates to 4,000 itself), and READMEs were by far the largest
 * thing in the database — 84 MB of live text plus its TOAST overhead. The detail
 * page's "Preview" tab renders the FULL readme fetched live from GitHub, so the
 * only thing a smaller excerpt shortens is the "Source" tab.
 */
const README_EXCERPT_CHARS = 4_000;

/**
 * How many repos one GraphQL call group covers. The client chunks internally
 * (20 with READMEs, 50 without) — this outer grouping only bounds the blast
 * radius of a non-recoverable error to 200 repos instead of the whole run.
 */
const GRAPH_GROUP = 200;

/** Contributor data is server-cached and hours stale anyway; weekly is plenty. */
const CONTRIBUTOR_REFRESH_DAYS = 7;

const DAY_MS = 86_400_000;

export interface SyncOptions {
  /** Work-queue size. One run of 1,000 is ~50 GraphQL calls. */
  limit?: number;
  /** README blobs are the #1 cause of the 10s GraphQL timeout. */
  includeReadme?: boolean;
  /** Cap on the extra REST calls spent refreshing contributor stats. */
  contributorLimit?: number;
  /** Cap on REST README fallbacks for repos GraphQL could not find one for. */
  readmeLimit?: number;
  /** Outbound concurrency for the REST side-calls. */
  concurrency?: number;
  log?: (message: string) => void;
}

export interface SyncStats extends Record<string, number | string> {
  queued: number;
  refreshed: number;
  renamed: number;
  rejected: number;
  notModified: number;
  readmesFetched: number;
  contributorsRefreshed: number;
  namesReleased: number;
  missing: number;
  errors: number;
}

interface QueuedRepo {
  id: number;
  githubId: number;
  nodeId: string | null;
  fullName: string;
  etag: string | null;
  contributorsCount: number | null;
  lastSyncedAt: Date | null;
}

/** Everything sync is allowed to write. Optional fields mean "leave as-is". */
interface RepoUpdate {
  githubId: number;
  nodeId: string | null;
  fullName: string;
  ownerLogin: string;
  name: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  topics: string[];
  licenseSpdxId: string | null;
  licenseName: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  watchers: number;
  sizeKb: number;
  defaultBranch: string | null;
  isFork: boolean;
  isArchived: boolean;
  isTemplate: boolean;
  ownerType: string | null;
  ownerAvatarUrl: string | null;
  ownerLocation: string | null;
  githubCreatedAt: Date | null;
  githubPushedAt: Date | null;
  githubUpdatedAt: Date | null;
  latestReleaseTag: string | null;
  latestReleaseAt: Date | null;
  releasesLastYear: number | null;
  readmeExcerpt: string | null;
  readmeLength: number | null;
  contributorsCount: number | null;
  topContributorShare: number | null;
  etag: string | null;
}

function fromGraph(repo: GraphRepo, existingGithubId: number): RepoUpdate {
  return {
    // databaseId is nullable in the GraphQL schema; falling back to the id we
    // already have keeps the upsert keyed correctly instead of inserting a 0 row.
    githubId: repo.githubId ?? existingGithubId,
    nodeId: repo.nodeId,
    fullName: repo.fullName,
    ownerLogin: repo.ownerLogin,
    name: repo.name,
    description: repo.description,
    homepage: repo.homepage,
    language: repo.language,
    topics: repo.topics,
    licenseSpdxId: repo.licenseSpdxId,
    licenseName: repo.licenseName,
    stars: repo.stars,
    forks: repo.forks,
    openIssues: repo.openIssues,
    watchers: repo.watchers,
    sizeKb: repo.sizeKb,
    defaultBranch: repo.defaultBranch,
    isFork: repo.isFork,
    isArchived: repo.isArchived,
    isTemplate: repo.isTemplate,
    ownerType: repo.ownerType,
    ownerAvatarUrl: repo.ownerAvatarUrl,
    ownerLocation: repo.ownerLocation,
    githubCreatedAt: parseDate(repo.createdAt),
    githubPushedAt: parseDate(repo.pushedAt),
    githubUpdatedAt: parseDate(repo.updatedAt),
    latestReleaseTag: repo.latestReleaseTag,
    latestReleaseAt: parseDate(repo.latestReleaseAt),
    releasesLastYear: repo.releasesLastYear,
    readmeExcerpt: repo.readme ? repo.readme.slice(0, README_EXCERPT_CHARS) : null,
    readmeLength: repo.readme ? repo.readme.length : null,
    contributorsCount: null,
    topContributorShare: null,
    etag: null,
  };
}

function fromRest(item: SearchRepoItem): RepoUpdate {
  return {
    githubId: item.id,
    nodeId: item.node_id || null,
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
    // The REST repo object carries no owner location; leave the stored value.
    ownerLocation: null,
    githubCreatedAt: parseDate(item.created_at),
    githubPushedAt: parseDate(item.pushed_at),
    githubUpdatedAt: parseDate(item.updated_at),
    // Releases are a GraphQL-only enrichment here; don't clobber what we have.
    latestReleaseTag: null,
    latestReleaseAt: null,
    releasesLastYear: null,
    readmeExcerpt: null,
    readmeLength: null,
    contributorsCount: null,
    topContributorShare: null,
    etag: null,
  };
}

export async function sync(options: SyncOptions = {}): Promise<SyncStats> {
  const log = options.log ?? ((message: string) => console.log(`  ${message}`));
  const limit = options.limit ?? 1_000;
  const includeReadme = options.includeReadme ?? true;
  const contributorLimit = options.contributorLimit ?? 200;
  const readmeLimit = options.readmeLimit ?? 200;
  const concurrency = options.concurrency ?? 6;

  const stats: SyncStats = {
    queued: 0,
    refreshed: 0,
    renamed: 0,
    rejected: 0,
    notModified: 0,
    readmesFetched: 0,
    contributorsRefreshed: 0,
    namesReleased: 0,
    missing: 0,
    errors: 0,
  };

  // Oldest-synced first, never-synced before everything. `nulls first` is the
  // point of the whole ordering: a freshly discovered repo has no metadata at
  // all until this job touches it.
  const queue: QueuedRepo[] = await db
    .select({
      id: repositories.id,
      githubId: repositories.githubId,
      nodeId: repositories.nodeId,
      fullName: repositories.fullName,
      etag: repositories.etag,
      contributorsCount: repositories.contributorsCount,
      lastSyncedAt: repositories.lastSyncedAt,
    })
    .from(repositories)
    .where(eq(repositories.status, 'active'))
    .orderBy(sql`${repositories.lastSyncedAt} asc nulls first`)
    .limit(limit);

  stats.queued = queue.length;
  if (queue.length === 0) {
    log('nothing to sync');
    return stats;
  }
  log(`queued ${queue.length} repo(s)`);

  const updates = new Map<number, RepoUpdate>();
  const goneIds: number[] = [];
  const touchedIds: number[] = [];

  // ------------------------------------------------------------- pass 1: GQL --
  for (const group of chunk(queue, GRAPH_GROUP)) {
    let fetched: GraphRepo[] = [];
    try {
      fetched = await github.getReposByFullNames(
        group.map((row) => row.fullName),
        { includeReadme },
      );
    } catch (error) {
      stats.errors++;
      log(`graphql group failed (${group.length} repos): ${describe(error)}`);
      continue;
    }

    // Re-key, never zip: renames change the name and failures drop entries.
    const byGithubId = new Map<number, GraphRepo>();
    const byName = new Map<string, GraphRepo>();
    for (const repo of fetched) {
      if (repo.githubId !== null) byGithubId.set(repo.githubId, repo);
      byName.set(repo.fullName.toLowerCase(), repo);
    }

    for (const row of group) {
      const repo = byGithubId.get(row.githubId) ?? byName.get(row.fullName.toLowerCase());
      if (!repo) continue;
      if (repo.fullName !== row.fullName) {
        stats.renamed++;
        log(`renamed: ${row.fullName} -> ${repo.fullName}`);
      }
      updates.set(row.id, fromGraph(repo, row.githubId));
    }

    log(`graphql: ${fetched.length}/${group.length} resolved (${updates.size} total)`);
  }

  // -------------------------------------------- pass 2: REST for the missing --
  const missing = queue.filter((row) => !updates.has(row.id));
  stats.missing = missing.length;

  if (missing.length > 0) {
    log(`resolving ${missing.length} repo(s) GraphQL did not return, via REST`);

    await mapLimit(missing, concurrency, async (row) => {
      try {
        // The stored ETag is echoed back verbatim (weak `W/` prefix included);
        // a 304 costs no primary quota because we always send Authorization.
        const result = await github.getRepoByFullName(row.fullName, row.etag);

        if (result.status === 'gone') {
          goneIds.push(row.id);
          stats.rejected++;
          return;
        }
        if (result.status === 'not-modified') {
          touchedIds.push(row.id);
          stats.notModified++;
          return;
        }

        const update = fromRest(result.repo);
        update.etag = result.etag;
        if (result.repo.full_name !== row.fullName) stats.renamed++;
        updates.set(row.id, update);
      } catch (error) {
        stats.errors++;
        log(`rest lookup failed for ${row.fullName}: ${describe(error)}`);
      }
    });
  }

  // ------------------------------------------------- pass 3: README fallback --
  // GraphQL probes seven fixed, case-sensitive paths and misses ~15-25% of
  // READMEs. REST resolves whatever the repo actually calls its readme, so it
  // is the correct source — but it costs one core request each, hence the cap.
  const needReadme = [...updates.entries()]
    .filter(([, update]) => update.readmeExcerpt === null)
    .slice(0, readmeLimit);

  if (includeReadme && needReadme.length > 0) {
    await mapLimit(needReadme, concurrency, async ([, update]) => {
      try {
        const readme = await github.getReadme(update.fullName);
        if (readme === null) return;
        update.readmeExcerpt = readme.slice(0, README_EXCERPT_CHARS);
        update.readmeLength = readme.length;
        stats.readmesFetched++;
      } catch (error) {
        stats.errors++;
        log(`readme fetch failed for ${update.fullName}: ${describe(error)}`);
      }
    });
    log(`readme fallback: ${stats.readmesFetched}/${needReadme.length} recovered`);
  }

  // --------------------------------------------------- pass 4: contributors --
  const cutoff = Date.now() - CONTRIBUTOR_REFRESH_DAYS * DAY_MS;
  const needContributors = queue
    .filter((row) => updates.has(row.id))
    .filter(
      (row) =>
        row.contributorsCount === null ||
        row.lastSyncedAt === null ||
        row.lastSyncedAt.getTime() < cutoff,
    )
    .slice(0, contributorLimit);

  if (needContributors.length > 0) {
    await mapLimit(needContributors, concurrency, async (row) => {
      const update = updates.get(row.id);
      if (!update) return;
      try {
        // One call answers both questions for the ~99% of repos with under 100
        // contributors: the length IS the exact count, and the contribution
        // counts give the bus-factor share.
        const top = await github.getTopContributors(update.fullName, 100);
        if (top.length === 0) return;

        let count = top.length;
        if (top.length >= 100) {
          // Only now is the Link-header trick worth a second request. Its answer
          // saturates around 300, so treat it as a lower bound, never an exact.
          const measured = await github.getContributorCount(update.fullName);
          count = measured.count ?? top.length;
        }

        const totalKnown = top.reduce((sum, person) => sum + person.contributions, 0);
        update.contributorsCount = count;
        // Share of the commits we can see. For repos with more than 100
        // contributors this over-states the top author's dominance, because the
        // denominator is truncated at 100 — the scoring model treats it as a
        // bus-factor signal, not a precise statistic.
        update.topContributorShare =
          totalKnown > 0 ? Number((top[0]!.contributions / totalKnown).toFixed(4)) : null;
        stats.contributorsRefreshed++;
      } catch (error) {
        stats.errors++;
        log(`contributor fetch failed for ${update.fullName}: ${describe(error)}`);
      }
    });
    log(`contributors: ${stats.contributorsRefreshed}/${needContributors.length} refreshed`);
  }

  // ------------------------------------------------------------------ write --
  // Dedupe on githubId before writing. Two queued rows can resolve to the SAME
  // repository when one of them was renamed into the other's old name, and
  // Postgres rejects the whole statement with "ON CONFLICT DO UPDATE command
  // cannot affect row a second time" if the same conflict key appears twice.
  const deduped = new Map<number, RepoUpdate>();
  for (const update of updates.values()) deduped.set(update.githubId, update);
  const rows = [...deduped.values()];

  if (rows.length > 0) {
    stats.namesReleased = await releaseConflictingFullNames(rows);

    for (const batch of chunk(rows, REPO_INSERT_CHUNK)) {
      await db
        .insert(repositories)
        .values(batch)
        .onConflictDoUpdate({
          target: repositories.githubId,
          set: {
            nodeId: sql`coalesce(excluded.node_id, repositories.node_id)`,
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
            // Every field below is refreshed for a SUBSET of the batch only, so
            // a null in `excluded` means "not fetched this run", never "gone".
            // coalesce keeps the previous value instead of erasing it.
            ownerLocation: sql`coalesce(excluded.owner_location, repositories.owner_location)`,
            latestReleaseTag: sql`coalesce(excluded.latest_release_tag, repositories.latest_release_tag)`,
            latestReleaseAt: sql`coalesce(excluded.latest_release_at, repositories.latest_release_at)`,
            releasesLastYear: sql`coalesce(excluded.releases_last_year, repositories.releases_last_year)`,
            readmeExcerpt: sql`coalesce(excluded.readme_excerpt, repositories.readme_excerpt)`,
            readmeLength: sql`coalesce(excluded.readme_length, repositories.readme_length)`,
            contributorsCount: sql`coalesce(excluded.contributors_count, repositories.contributors_count)`,
            topContributorShare: sql`coalesce(excluded.top_contributor_share, repositories.top_contributor_share)`,
            etag: sql`coalesce(excluded.etag, repositories.etag)`,
            lastSyncedAt: sql`now()`,
          },
        });
      stats.refreshed += batch.length;
    }
  }

  // A 304 means "nothing changed", which is still a successful sync — bump the
  // watermark or the same repos monopolise the queue forever.
  for (const batch of chunk(touchedIds, REPO_INSERT_CHUNK)) {
    await db
      .update(repositories)
      .set({ lastSyncedAt: sql`now()` })
      .where(inArray(repositories.id, batch));
  }

  // 404/410/451 only. A GraphQL miss alone never rejects a repo.
  for (const batch of chunk(goneIds, REPO_INSERT_CHUNK)) {
    await db
      .update(repositories)
      .set({ status: 'rejected', lastSyncedAt: sql`now()` })
      .where(and(inArray(repositories.id, batch), eq(repositories.status, 'active')));
  }

  log(
    `refreshed ${stats.refreshed}, rejected ${stats.rejected}, ` +
      `renamed ${stats.renamed}, errors ${stats.errors}`,
  );
  return stats;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

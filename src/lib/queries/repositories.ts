/**
 * The repository read layer.
 *
 * Everything the site shows about repositories funnels through `listRepositories`
 * and `getRepositoryByFullName`. Both are written against the denormalised
 * columns the ingestion pipeline maintains (starsDay/starsWeek/starsMonth,
 * trendScore, trendVelocity, qualityScore) so that a sorted, filtered page is an
 * index scan rather than a join against the 90-day snapshot table.
 *
 * The one rule that governs the shape of this file: a page of N results costs a
 * bounded number of queries, never N. Category chips are fetched for the whole
 * page in a single follow-up query and stitched in JS.
 */

import {
  and,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';

import { db } from '@/db';
import {
  categories,
  contributors,
  repositories,
  repositoryCategories,
  repositoryContributors,
  repositoryMetrics,
} from '@/db/schema';
import { classifyLicense, type LicenseClass } from '@/lib/scoring';
import { daysAgoIso, isoDate } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * `stars-month` is not in the original spec but the homepage needs a 30-day
 * window and the column already exists; adding it here is strictly additive.
 */
export type RepoSort =
  | 'trending'
  | 'stars'
  | 'stars-today'
  | 'stars-week'
  | 'stars-month'
  | 'velocity'
  | 'quality'
  | 'newest'
  | 'recently-updated'
  | 'relevance';

export interface RepoListParams {
  q?: string;
  category?: string;
  group?: string;
  language?: string;
  license?: LicenseClass;
  country?: string;
  minStars?: number;
  maxStars?: number;
  minQuality?: number;
  createdAfter?: string;
  pushedAfter?: string;
  includeArchived?: boolean;
  sort?: RepoSort;
  page?: number;
  perPage?: number;
}

export interface CategoryRef {
  slug: string;
  name: string;
  groupSlug: string;
}

export interface RepoListItem {
  id: number;
  fullName: string;
  ownerLogin: string;
  name: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  topics: string[];
  licenseSpdxId: string | null;
  licenseName: string | null;
  /** Derived in JS from the SPDX id so the UI never has to know SPDX. */
  licenseClass: LicenseClass;
  stars: number;
  forks: number;
  openIssues: number;
  starsDay: number;
  starsWeek: number;
  starsMonth: number;
  trendScore: number;
  trendVelocity: number;
  qualityScore: number | null;
  qualityGrade: string | null;
  isArchived: boolean;
  isFork: boolean;
  ownerAvatarUrl: string | null;
  ownerCountry: string | null;
  githubCreatedAt: Date | null;
  githubPushedAt: Date | null;
  latestReleaseAt: Date | null;
  contributorsCount: number | null;
  primaryCategory: CategoryRef | null;
  /** Primary first, then by classifier confidence. */
  categories: CategoryRef[];
  /** ts_rank against the search vector; 0 when the request had no `q`. */
  relevance: number;
}

export interface RepoListResult {
  items: RepoListItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface CategoryAssignment extends CategoryRef {
  isPrimary: boolean;
  confidence: number;
  source: string;
  evidence: string[];
}

export interface RepoContributor {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  company: string | null;
  country: string | null;
  city: string | null;
  followers: number;
  contributions: number;
  rank: number | null;
}

export interface RepoMetricPoint {
  recordedOn: string;
  stars: number;
  forks: number;
  openIssues: number;
  watchers: number;
  contributorsCount: number | null;
}

export interface RepositoryDetail {
  id: number;
  githubId: number;
  fullName: string;
  ownerLogin: string;
  name: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  topics: string[];
  licenseSpdxId: string | null;
  licenseName: string | null;
  licenseClass: LicenseClass;
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
  ownerCountry: string | null;
  githubCreatedAt: Date | null;
  githubPushedAt: Date | null;
  githubUpdatedAt: Date | null;
  latestReleaseTag: string | null;
  latestReleaseAt: Date | null;
  releasesLastYear: number | null;
  contributorsCount: number | null;
  topContributorShare: number | null;
  readmeExcerpt: string | null;
  readmeLength: number | null;
  starsDay: number;
  starsWeek: number;
  starsMonth: number;
  trendScore: number;
  trendVelocity: number;
  qualityScore: number | null;
  qualityGrade: string | null;
  /** Plain-language reasons from computeQualityScore, shown verbatim. */
  qualityFlags: string[];
  lastSyncedAt: Date | null;
  firstSeenAt: Date;
  discoverySource: string | null;
  primaryCategory: CategoryRef | null;
  categories: CategoryAssignment[];
  contributors: RepoContributor[];
  /** Oldest first — chart libraries want ascending x. */
  metrics: RepoMetricPoint[];
}

// ---------------------------------------------------------------------------
// Shared column projections
// ---------------------------------------------------------------------------

/**
 * Never `select().from(repositories)`: that drags the generated `search_vector`
 * across the wire as a multi-kilobyte text blob for every row.
 */
const repoCardColumns = {
  id: repositories.id,
  fullName: repositories.fullName,
  ownerLogin: repositories.ownerLogin,
  name: repositories.name,
  description: repositories.description,
  homepage: repositories.homepage,
  language: repositories.language,
  topics: repositories.topics,
  licenseSpdxId: repositories.licenseSpdxId,
  licenseName: repositories.licenseName,
  stars: repositories.stars,
  forks: repositories.forks,
  openIssues: repositories.openIssues,
  starsDay: repositories.starsDay,
  starsWeek: repositories.starsWeek,
  starsMonth: repositories.starsMonth,
  trendScore: repositories.trendScore,
  trendVelocity: repositories.trendVelocity,
  qualityScore: repositories.qualityScore,
  qualityGrade: repositories.qualityGrade,
  isArchived: repositories.isArchived,
  isFork: repositories.isFork,
  ownerAvatarUrl: repositories.ownerAvatarUrl,
  ownerCountry: repositories.ownerCountry,
  githubCreatedAt: repositories.githubCreatedAt,
  githubPushedAt: repositories.githubPushedAt,
  latestReleaseAt: repositories.latestReleaseAt,
  contributorsCount: repositories.contributorsCount,
} as const;

const PER_PAGE_DEFAULT = 24;
const PER_PAGE_MAX = 100;
const METRIC_HISTORY_DAYS = 90;
const DETAIL_CONTRIBUTOR_LIMIT = 20;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Neutralise LIKE wildcards in user input. Without this, searching "100%" or
 * "snake_case" silently becomes a wildcard pattern and matches far too much.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function parseDateParam(value: string, label: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`${label} must be an ISO date, got "${value}"`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// License-class filtering
// ---------------------------------------------------------------------------

/**
 * `classifyLicense` is the single source of truth for what "permissive" means,
 * and it is a JS function — there is no license_class column to filter on. So
 * instead of re-encoding the SPDX groupings in SQL (where they would silently
 * drift from scoring.ts) we resolve the *distinct* SPDX ids actually present in
 * the table, classify them in JS, and filter with an IN list.
 *
 * That distinct scan is cheap (dozens of values) but not free, so it is cached
 * in process. A stale window only matters when a repo carrying a brand-new SPDX
 * id is indexed, and the worst case is that repo missing from one filtered page
 * for a few minutes.
 */
const LICENSE_INDEX_TTL_MS = 5 * 60_000;

let licenseIndex: { byClass: Map<LicenseClass, string[]>; expiresAt: number } | null = null;

async function licenseIdsForClass(licenseClass: LicenseClass): Promise<string[]> {
  const now = Date.now();

  if (!licenseIndex || licenseIndex.expiresAt <= now) {
    const rows = await db
      .selectDistinct({ spdxId: repositories.licenseSpdxId })
      .from(repositories)
      .where(eq(repositories.status, 'active'));

    const byClass = new Map<LicenseClass, string[]>();
    for (const row of rows) {
      // Null/blank ids are the 'none' class and are matched with a predicate
      // rather than an IN list, so they are deliberately skipped here.
      if (!row.spdxId || row.spdxId.trim() === '') continue;
      const key = classifyLicense(row.spdxId);
      const bucket = byClass.get(key);
      if (bucket) bucket.push(row.spdxId);
      else byClass.set(key, [row.spdxId]);
    }

    licenseIndex = { byClass, expiresAt: now + LICENSE_INDEX_TTL_MS };
  }

  return licenseIndex.byClass.get(licenseClass) ?? [];
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/**
 * Correlated EXISTS rather than a join: a repo can hold several category rows
 * and a join would multiply it across the result set, breaking both the page
 * size and the window count.
 */
function primaryCategoryExists(condition: SQL): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(repositoryCategories)
      .innerJoin(categories, eq(categories.id, repositoryCategories.categoryId))
      .where(
        and(
          eq(repositoryCategories.repositoryId, repositories.id),
          eq(repositoryCategories.isPrimary, true),
          condition,
        ),
      ),
  );
}

async function buildFilters(params: RepoListParams): Promise<SQL[]> {
  // Rejected repos are kept in the table purely so discovery stops re-finding
  // them; they must never surface in a listing.
  const filters: SQL[] = [eq(repositories.status, 'active')];

  if (!params.includeArchived) {
    filters.push(eq(repositories.isArchived, false));
  }

  const q = params.q?.trim();
  if (q) {
    /**
     * Two matchers, OR'd, because they answer different questions:
     *
     * - Full-text search handles words and phrases across the name, description
     *   and topics. websearch_to_tsquery never throws on user input, which is why
     *   it is the only tsquery variant safe to hand a raw search box. A query of
     *   pure stopwords yields an empty tsquery and legitimately matches nothing.
     * - A substring match on the name handles what FTS structurally cannot: a
     *   FRAGMENT. FTS compares whole stems, so "livecap" or "captions-trans"
     *   match nothing no matter how the vector is built. People searching a
     *   directory type partial repo and owner names constantly, so this is not an
     *   edge case. Backed by the pg_trgm index from migration 0002.
     */
    filters.push(
      sql`(${repositories.searchVector} @@ websearch_to_tsquery('english', ${q})
           or ${repositories.fullName} ilike ${'%' + escapeLike(q) + '%'})`,
    );
  }

  if (params.category) {
    filters.push(primaryCategoryExists(eq(categories.slug, params.category)));
  }
  if (params.group) {
    filters.push(primaryCategoryExists(eq(categories.groupSlug, params.group)));
  }

  // Exact match keeps the btree index usable. The dropdown is fed by
  // getLanguages(), which returns the values verbatim, so there is nothing to
  // case-fold.
  if (params.language) filters.push(eq(repositories.language, params.language));
  if (params.country) filters.push(eq(repositories.ownerCountry, params.country));

  if (params.minStars !== undefined) filters.push(gte(repositories.stars, params.minStars));
  if (params.maxStars !== undefined) filters.push(lte(repositories.stars, params.maxStars));
  if (params.minQuality !== undefined) {
    filters.push(gte(repositories.qualityScore, params.minQuality));
  }

  if (params.createdAfter) {
    filters.push(
      gte(repositories.githubCreatedAt, parseDateParam(params.createdAfter, 'createdAfter')),
    );
  }
  if (params.pushedAfter) {
    filters.push(
      gte(repositories.githubPushedAt, parseDateParam(params.pushedAfter, 'pushedAfter')),
    );
  }

  if (params.license) {
    if (params.license === 'none') {
      // Mirrors classifyLicense(): null, '' and whitespace-only all mean "no
      // license identifier".
      filters.push(sql`coalesce(btrim(${repositories.licenseSpdxId}), '') = ''`);
    } else {
      const ids = await licenseIdsForClass(params.license);
      // An empty IN list would be a SQL error; nothing in the corpus carries
      // that license class, so the honest answer is zero rows.
      filters.push(ids.length > 0 ? inArray(repositories.licenseSpdxId, ids) : sql`false`);
    }
  }

  return filters;
}

function orderClause(sort: RepoSort, relevance: SQL<number>): SQL[] {
  switch (sort) {
    case 'stars':
      return [desc(repositories.stars)];
    case 'stars-today':
      return [desc(repositories.starsDay)];
    case 'stars-week':
      return [desc(repositories.starsWeek)];
    case 'stars-month':
      return [desc(repositories.starsMonth)];
    case 'velocity':
      return [desc(repositories.trendVelocity)];
    // Postgres sorts NULLs FIRST on DESC, which would put unscored repos at the
    // top of every quality/date ranking. Spell out NULLS LAST.
    case 'quality':
      return [sql`${repositories.qualityScore} desc nulls last`];
    case 'newest':
      return [sql`${repositories.githubCreatedAt} desc nulls last`];
    case 'recently-updated':
      return [sql`${repositories.githubPushedAt} desc nulls last`];
    case 'relevance':
      return [desc(relevance)];
    case 'trending':
    default:
      return [desc(repositories.trendScore)];
  }
}

// ---------------------------------------------------------------------------
// listRepositories
// ---------------------------------------------------------------------------

export async function listRepositories(params: RepoListParams = {}): Promise<RepoListResult> {
  const perPage = clampInt(params.perPage ?? PER_PAGE_DEFAULT, 1, PER_PAGE_MAX);
  const page = clampInt(params.page ?? 1, 1, Number.MAX_SAFE_INTEGER);
  const offset = (page - 1) * perPage;

  const q = params.q?.trim();

  // Ranking a repo against an empty query is meaningless, and Postgres would
  // happily return 0 for every row and then sort arbitrarily. Fall back to the
  // default ranking instead of pretending the request made sense.
  const requestedSort = params.sort ?? 'trending';
  const sort: RepoSort = requestedSort === 'relevance' && !q ? 'trending' : requestedSort;

  /**
   * Relevance = text-search rank plus a name-match boost.
   *
   * The boost does two jobs. It lifts a name hit above a repo that merely
   * mentions the word in its description, which is what someone typing a repo
   * name wants. And it gives substring-only matches a non-zero score — ts_rank
   * returns 0 for them (they matched the ILIKE, not the tsquery), so without it
   * they would all tie at the bottom in arbitrary order.
   */
  const relevance: SQL<number> = q
    ? sql<number>`(
        ts_rank(${repositories.searchVector}, websearch_to_tsquery('english', ${q}))
        + case
            when ${repositories.fullName} ilike ${escapeLike(q) + '%'} then 1.0
            when ${repositories.name} ilike ${escapeLike(q) + '%'} then 0.8
            when ${repositories.fullName} ilike ${'%' + escapeLike(q) + '%'} then 0.4
            else 0
          end
      )`
    : sql<number>`0::float8`;

  const filters = await buildFilters(params);
  const where = and(...filters);

  const rows = await db
    .select({
      ...repoCardColumns,
      relevance,
      // One scan instead of two. The window is evaluated over the whole
      // filtered set before LIMIT applies, so this total is exact — but the
      // rows themselves are still capped at `perPage`.
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(repositories)
    .where(where)
    // The id tiebreaker is not cosmetic: without a total order, two repos with
    // equal trendScore can swap between page 1 and page 2 and be shown twice
    // or not at all.
    .orderBy(...orderClause(sort, relevance), desc(repositories.id))
    .limit(perPage)
    .offset(offset);

  let total = rows.length > 0 ? rows[0].total : 0;
  if (rows.length === 0) {
    // A page past the end returns no rows, and the window count goes with
    // them. Only in that case do we pay for a dedicated COUNT.
    const [counted] = await db
      .select({ total: count() })
      .from(repositories)
      .where(where);
    total = counted?.total ?? 0;
  }

  const categoriesByRepo = await categoriesForRepositories(rows.map((row) => row.id));

  const items: RepoListItem[] = rows.map((row) => {
    const refs = categoriesByRepo.get(row.id) ?? [];
    return {
      id: row.id,
      fullName: row.fullName,
      ownerLogin: row.ownerLogin,
      name: row.name,
      description: row.description,
      homepage: row.homepage,
      language: row.language,
      topics: row.topics,
      licenseSpdxId: row.licenseSpdxId,
      licenseName: row.licenseName,
      licenseClass: classifyLicense(row.licenseSpdxId),
      stars: row.stars,
      forks: row.forks,
      openIssues: row.openIssues,
      starsDay: row.starsDay,
      starsWeek: row.starsWeek,
      starsMonth: row.starsMonth,
      trendScore: row.trendScore,
      trendVelocity: row.trendVelocity,
      qualityScore: row.qualityScore,
      qualityGrade: row.qualityGrade,
      isArchived: row.isArchived,
      isFork: row.isFork,
      ownerAvatarUrl: row.ownerAvatarUrl,
      ownerCountry: row.ownerCountry,
      githubCreatedAt: row.githubCreatedAt,
      githubPushedAt: row.githubPushedAt,
      latestReleaseAt: row.latestReleaseAt,
      contributorsCount: row.contributorsCount,
      primaryCategory: refs.find((ref) => ref.isPrimary) ?? null,
      categories: refs.map(({ slug, name, groupSlug }) => ({ slug, name, groupSlug })),
      relevance: row.relevance,
    };
  });

  return {
    items,
    total,
    page,
    perPage,
    totalPages: total === 0 ? 0 : Math.ceil(total / perPage),
  };
}

/**
 * Turn the raw snapshot rows into the chart series.
 *
 * Two things happen here, both because snapshots are change-only:
 *   - the row from before the window (if any) is kept as the opening anchor, so a
 *     long-quiet repo still draws a line instead of claiming no history;
 *   - the repo's CURRENT values are appended as today's point unless a row was
 *     already written today. A repo that has not changed has no row today, but we
 *     still know exactly what it reads right now.
 */
function buildMetricSeries(
  rows: readonly {
    recorded_on: string;
    stars: number;
    forks: number;
    open_issues: number;
    watchers: number;
    contributors_count: number | null;
  }[],
  stars: number,
  forks: number,
  openIssues: number,
  watchers: number,
): RepoMetricPoint[] {
  const series: RepoMetricPoint[] = rows.map((r) => ({
    recordedOn: r.recorded_on,
    stars: r.stars,
    forks: r.forks,
    openIssues: r.open_issues,
    watchers: r.watchers,
    contributorsCount: r.contributors_count,
  }));

  const today = isoDate();
  if (series.length > 0 && series[series.length - 1]!.recordedOn !== today) {
    series.push({
      recordedOn: today,
      stars,
      forks,
      openIssues,
      watchers,
      contributorsCount: null,
    });
  }

  return series;
}

/**
 * The one extra query that keeps the list endpoint at O(1) round trips:
 * every category assignment for the page, keyed by repository id.
 */
async function categoriesForRepositories(
  repositoryIds: number[],
): Promise<Map<number, (CategoryRef & { isPrimary: boolean })[]>> {
  const byRepo = new Map<number, (CategoryRef & { isPrimary: boolean })[]>();
  if (repositoryIds.length === 0) return byRepo;

  const rows = await db
    .select({
      repositoryId: repositoryCategories.repositoryId,
      isPrimary: repositoryCategories.isPrimary,
      slug: categories.slug,
      name: categories.name,
      groupSlug: categories.groupSlug,
    })
    .from(repositoryCategories)
    .innerJoin(categories, eq(categories.id, repositoryCategories.categoryId))
    .where(inArray(repositoryCategories.repositoryId, repositoryIds))
    .orderBy(desc(repositoryCategories.isPrimary), desc(repositoryCategories.confidence));

  for (const row of rows) {
    const entry = {
      slug: row.slug,
      name: row.name,
      groupSlug: row.groupSlug,
      isPrimary: row.isPrimary,
    };
    const bucket = byRepo.get(row.repositoryId);
    if (bucket) bucket.push(entry);
    else byRepo.set(row.repositoryId, [entry]);
  }

  return byRepo;
}

// ---------------------------------------------------------------------------
// getRepositoryByFullName
// ---------------------------------------------------------------------------

function selectRepositoryDetailRow(where: SQL) {
  return db
    .select({
      ...repoCardColumns,
      githubId: repositories.githubId,
      watchers: repositories.watchers,
      sizeKb: repositories.sizeKb,
      defaultBranch: repositories.defaultBranch,
      isTemplate: repositories.isTemplate,
      ownerType: repositories.ownerType,
      ownerLocation: repositories.ownerLocation,
      githubUpdatedAt: repositories.githubUpdatedAt,
      latestReleaseTag: repositories.latestReleaseTag,
      releasesLastYear: repositories.releasesLastYear,
      topContributorShare: repositories.topContributorShare,
      readmeExcerpt: repositories.readmeExcerpt,
      readmeLength: repositories.readmeLength,
      qualityFlags: repositories.qualityFlags,
      lastSyncedAt: repositories.lastSyncedAt,
      firstSeenAt: repositories.firstSeenAt,
      discoverySource: repositories.discoverySource,
    })
    .from(repositories)
    .where(where)
    .limit(1);
}

export async function getRepositoryByFullName(
  fullName: string,
): Promise<RepositoryDetail | null> {
  const normalized = fullName.trim().replace(/^\/+|\/+$/g, '');
  if (!normalized.includes('/')) return null;

  // Exact match first: that is a single lookup on repositories_full_name_uq.
  // GitHub slugs are case-insensitive, so a miss is retried case-folded — but
  // that variant cannot use the index (there is no lower(full_name) index), so
  // it must stay off the hot path rather than being folded into one OR.
  let [row] = await selectRepositoryDetailRow(eq(repositories.fullName, normalized));

  if (!row) {
    [row] = await selectRepositoryDetailRow(
      sql`lower(${repositories.fullName}) = ${normalized.toLowerCase()}`,
    );
  }

  if (!row) return null;

  const [categoryRows, contributorRows, metricRows] = await Promise.all([
    db
      .select({
        slug: categories.slug,
        name: categories.name,
        groupSlug: categories.groupSlug,
        isPrimary: repositoryCategories.isPrimary,
        confidence: repositoryCategories.confidence,
        source: repositoryCategories.source,
        evidence: repositoryCategories.evidence,
      })
      .from(repositoryCategories)
      .innerJoin(categories, eq(categories.id, repositoryCategories.categoryId))
      .where(eq(repositoryCategories.repositoryId, row.id))
      .orderBy(desc(repositoryCategories.isPrimary), desc(repositoryCategories.confidence)),

    db
      .select({
        id: contributors.id,
        login: contributors.login,
        name: contributors.name,
        avatarUrl: contributors.avatarUrl,
        company: contributors.company,
        country: contributors.country,
        city: contributors.city,
        followers: contributors.followers,
        contributions: repositoryContributors.contributions,
        rank: repositoryContributors.rank,
      })
      .from(repositoryContributors)
      .innerJoin(contributors, eq(contributors.id, repositoryContributors.contributorId))
      .where(eq(repositoryContributors.repositoryId, row.id))
      .orderBy(desc(repositoryContributors.contributions))
      .limit(DETAIL_CONTRIBUTOR_LIMIT),

    /**
     * The history series, plus ONE row from before the window.
     *
     * Snapshots are change-only, so a repo that has been quiet for longer than
     * the window has no rows inside it at all — without an anchor the chart
     * would claim "collecting history" for a repo we have months of data on.
     * The anchor is the value that was still current when the window opened.
     */
    db.execute<{
      recorded_on: string;
      stars: number;
      forks: number;
      open_issues: number;
      watchers: number;
      contributors_count: number | null;
    }>(sql`
      (
        select recorded_on::text, stars, forks, open_issues, watchers, contributors_count
        from repository_metrics
        where repository_id = ${row.id}
          and recorded_on >= ${daysAgoIso(METRIC_HISTORY_DAYS)}::date
      )
      union all
      (
        select recorded_on::text, stars, forks, open_issues, watchers, contributors_count
        from repository_metrics
        where repository_id = ${row.id}
          and recorded_on < ${daysAgoIso(METRIC_HISTORY_DAYS)}::date
        order by recorded_on desc
        limit 1
      )
      order by recorded_on
    `),
  ]);

  const categoryList: CategoryAssignment[] = categoryRows.map((c) => ({
    slug: c.slug,
    name: c.name,
    groupSlug: c.groupSlug,
    isPrimary: c.isPrimary,
    confidence: c.confidence,
    source: c.source,
    evidence: c.evidence,
  }));

  const primary = categoryList.find((c) => c.isPrimary);

  return {
    id: row.id,
    githubId: row.githubId,
    fullName: row.fullName,
    ownerLogin: row.ownerLogin,
    name: row.name,
    description: row.description,
    homepage: row.homepage,
    language: row.language,
    topics: row.topics,
    licenseSpdxId: row.licenseSpdxId,
    licenseName: row.licenseName,
    licenseClass: classifyLicense(row.licenseSpdxId),
    stars: row.stars,
    forks: row.forks,
    openIssues: row.openIssues,
    watchers: row.watchers,
    sizeKb: row.sizeKb,
    defaultBranch: row.defaultBranch,
    isFork: row.isFork,
    isArchived: row.isArchived,
    isTemplate: row.isTemplate,
    ownerType: row.ownerType,
    ownerAvatarUrl: row.ownerAvatarUrl,
    ownerLocation: row.ownerLocation,
    ownerCountry: row.ownerCountry,
    githubCreatedAt: row.githubCreatedAt,
    githubPushedAt: row.githubPushedAt,
    githubUpdatedAt: row.githubUpdatedAt,
    latestReleaseTag: row.latestReleaseTag,
    latestReleaseAt: row.latestReleaseAt,
    releasesLastYear: row.releasesLastYear,
    contributorsCount: row.contributorsCount,
    topContributorShare: row.topContributorShare,
    readmeExcerpt: row.readmeExcerpt,
    readmeLength: row.readmeLength,
    starsDay: row.starsDay,
    starsWeek: row.starsWeek,
    starsMonth: row.starsMonth,
    trendScore: row.trendScore,
    trendVelocity: row.trendVelocity,
    qualityScore: row.qualityScore,
    qualityGrade: row.qualityGrade,
    qualityFlags: row.qualityFlags,
    lastSyncedAt: row.lastSyncedAt,
    firstSeenAt: row.firstSeenAt,
    discoverySource: row.discoverySource,
    primaryCategory: primary
      ? { slug: primary.slug, name: primary.name, groupSlug: primary.groupSlug }
      : null,
    categories: categoryList,
    contributors: contributorRows,
    metrics: buildMetricSeries(metricRows.rows, row.stars, row.forks, row.openIssues, row.watchers),
  };
}

// ---------------------------------------------------------------------------
// Homepage lists
// ---------------------------------------------------------------------------

export type TrendingWindow = 'day' | 'week' | 'month' | 'all';

const TRENDING_SORT: Record<TrendingWindow, RepoSort> = {
  day: 'stars-today',
  week: 'stars-week',
  month: 'stars-month',
  // "all" is the composite momentum score rather than a raw star delta: it
  // already discounts stale repos and rewards recent releases.
  all: 'trending',
};

export async function getTrendingRepositories(
  window: TrendingWindow = 'week',
  limit = 12,
): Promise<RepoListItem[]> {
  const { items } = await listRepositories({
    sort: TRENDING_SORT[window],
    perPage: clampInt(limit, 1, PER_PAGE_MAX),
    page: 1,
  });
  return items;
}

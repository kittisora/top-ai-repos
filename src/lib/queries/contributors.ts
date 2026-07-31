/**
 * Contributor rankings — the "who is actually building this" view.
 *
 * Ranked by how many *indexed* repositories a person contributes to first, and
 * only then by raw commit count. That ordering is deliberate: total commits
 * rewards whoever ran a codemod across a monorepo, whereas breadth across
 * distinct projects is what makes someone worth following.
 */

import { and, count, desc, eq, exists, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import {
  categories,
  contributors,
  repositories,
  repositoryCategories,
  repositoryContributors,
} from '@/db/schema';

export interface TopContributorsParams {
  country?: string;
  /** Category slug — matched against the repositories' PRIMARY assignment. */
  category?: string;
  group?: string;
  page?: number;
  perPage?: number;
}

export interface TopContributor {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  country: string | null;
  city: string | null;
  followers: number;
  publicRepos: number;
  /** Distinct indexed repositories this person contributes to. */
  repoCount: number;
  /** Summed contributions across those repositories. */
  contributions: number;
  /** Stars across the repositories they contribute to — reach, not ownership. */
  starsReached: number;
}

export interface TopContributorsResult {
  items: TopContributor[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

const PER_PAGE_DEFAULT = 50;
const PER_PAGE_MAX = 100;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Correlated EXISTS on the repository rather than another pair of joins: the
 * contributor query already groups, and adding category joins to the FROM list
 * would multiply contributions before the SUM ran.
 */
function repositoryHasPrimaryCategory(condition: SQL): SQL {
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

export async function getTopContributors(
  params: TopContributorsParams = {},
): Promise<TopContributorsResult> {
  const perPage = clampInt(params.perPage ?? PER_PAGE_DEFAULT, 1, PER_PAGE_MAX);
  const page = clampInt(params.page ?? 1, 1, Number.MAX_SAFE_INTEGER);
  const offset = (page - 1) * perPage;

  const filters: SQL[] = [eq(repositories.status, 'active')];
  if (params.country) filters.push(eq(contributors.country, params.country));
  if (params.category) {
    filters.push(repositoryHasPrimaryCategory(eq(categories.slug, params.category)));
  }
  if (params.group) {
    filters.push(repositoryHasPrimaryCategory(eq(categories.groupSlug, params.group)));
  }

  const repoCount = sql<number>`count(distinct ${repositoryContributors.repositoryId})`;
  const contributionSum = sql<number>`coalesce(sum(${repositoryContributors.contributions}), 0)`;

  const rows = await db
    .select({
      id: contributors.id,
      login: contributors.login,
      name: contributors.name,
      avatarUrl: contributors.avatarUrl,
      company: contributors.company,
      blog: contributors.blog,
      location: contributors.location,
      country: contributors.country,
      city: contributors.city,
      followers: contributors.followers,
      publicRepos: contributors.publicRepos,
      repoCount: repoCount.mapWith(Number),
      contributions: contributionSum.mapWith(Number),
      starsReached: sql<number>`coalesce(sum(${repositories.stars}), 0)`.mapWith(Number),
      // Window functions run after grouping, so this counts GROUPS — i.e. the
      // number of matching contributors, which is exactly the page total.
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(contributors)
    .innerJoin(
      repositoryContributors,
      eq(repositoryContributors.contributorId, contributors.id),
    )
    .innerJoin(repositories, eq(repositories.id, repositoryContributors.repositoryId))
    .where(and(...filters))
    .groupBy(contributors.id)
    .orderBy(desc(repoCount), desc(contributionSum), desc(contributors.followers))
    .limit(perPage)
    .offset(offset);

  let total = rows.length > 0 ? rows[0].total : 0;
  if (rows.length === 0) {
    // Past the last page the window count disappears along with the rows, so
    // count the groups explicitly via a derived table.
    const grouped = db
      .select({ id: contributors.id })
      .from(contributors)
      .innerJoin(
        repositoryContributors,
        eq(repositoryContributors.contributorId, contributors.id),
      )
      .innerJoin(repositories, eq(repositories.id, repositoryContributors.repositoryId))
      .where(and(...filters))
      .groupBy(contributors.id)
      .as('grouped');

    const [counted] = await db.select({ total: count() }).from(grouped);
    total = counted?.total ?? 0;
  }

  const items: TopContributor[] = rows.map((row) => ({
    id: row.id,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatarUrl,
    company: row.company,
    blog: row.blog,
    location: row.location,
    country: row.country,
    city: row.city,
    followers: row.followers,
    publicRepos: row.publicRepos,
    repoCount: row.repoCount,
    contributions: row.contributions,
    starsReached: row.starsReached,
  }));

  return {
    items,
    total,
    page,
    perPage,
    totalPages: total === 0 ? 0 : Math.ceil(total / perPage),
  };
}

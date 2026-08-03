/**
 * Category aggregates for the taxonomy landing pages and the nav.
 *
 * The whole point of this file is that the numbers behind ~35 categories cost
 * exactly one query. The naive version — loop the taxonomy, count per slug — is
 * 35 round trips and gets slower every time the taxonomy grows.
 */

import { and, asc, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { categories, repositories, repositoryCategories } from '@/db/schema';
import { GROUP_BY_SLUG, GROUPS } from '@/lib/taxonomy';
import { AGGREGATE_TTL_MS, memoize } from './cache';

export interface CategoryStat {
  slug: string;
  name: string;
  groupSlug: string;
  description: string | null;
  sortOrder: number;
  repoCount: number;
  totalStars: number;
  /** Stars gained across the category in the last 7 days. */
  starsWeek: number;
  /**
   * Median rather than mean: quality scores are bimodal (a long tail of
   * abandoned single-author repos drags an average down and hides that the
   * category also holds excellent projects).
   */
  medianQuality: number | null;
}

export interface CategoryGroupStats {
  slug: string;
  name: string;
  description: string;
  repoCount: number;
  totalStars: number;
  categories: CategoryStat[];
}

/**
 * Per-category aggregates, bucketed by taxonomy group.
 *
 * Counts follow the same visibility rules as the default listing — active,
 * non-archived, primary assignment only — so a category badge saying "112
 * repos" links to a page that actually shows 112 repos.
 */
async function loadCategoryStats(): Promise<CategoryGroupStats[]> {
  const rows = await db
    .select({
      slug: categories.slug,
      name: categories.name,
      groupSlug: categories.groupSlug,
      description: categories.description,
      sortOrder: categories.sortOrder,
      repoCount: sql<number>`count(${repositories.id})`.mapWith(Number),
      totalStars: sql<number>`coalesce(sum(${repositories.stars}), 0)`.mapWith(Number),
      starsWeek: sql<number>`coalesce(sum(${repositories.starsWeek}), 0)`.mapWith(Number),
      // percentile_cont ignores NULLs, so unscored repos neither count nor
      // distort. It returns NULL for an empty category, which is honest.
      medianQuality: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${repositories.qualityScore}::float8)`,
    })
    .from(categories)
    // LEFT JOIN, twice: a category with no repos yet must still appear in the
    // nav with a zero, not vanish.
    .leftJoin(
      repositoryCategories,
      and(
        eq(repositoryCategories.categoryId, categories.id),
        eq(repositoryCategories.isPrimary, true),
      ),
    )
    .leftJoin(
      repositories,
      and(
        eq(repositories.id, repositoryCategories.repositoryId),
        eq(repositories.status, 'active'),
        eq(repositories.isArchived, false),
      ),
    )
    // Grouping by the primary key lets Postgres treat every other categories.*
    // column as functionally dependent, so they need not be repeated here.
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  const byGroup = new Map<string, CategoryStat[]>();
  for (const row of rows) {
    const stat: CategoryStat = {
      slug: row.slug,
      name: row.name,
      groupSlug: row.groupSlug,
      description: row.description,
      sortOrder: row.sortOrder,
      repoCount: row.repoCount,
      totalStars: row.totalStars,
      starsWeek: row.starsWeek,
      medianQuality: row.medianQuality === null ? null : Number(row.medianQuality),
    };
    const bucket = byGroup.get(row.groupSlug);
    if (bucket) bucket.push(stat);
    else byGroup.set(row.groupSlug, [stat]);
  }

  // Iterate GROUPS rather than the map so the group order is the taxonomy's,
  // not whatever order the rows happened to arrive in.
  const ordered: CategoryGroupStats[] = GROUPS.map((group) => {
    const members = byGroup.get(group.slug) ?? [];
    byGroup.delete(group.slug);
    return {
      slug: group.slug,
      name: group.name,
      description: group.description,
      repoCount: members.reduce((sum, c) => sum + c.repoCount, 0),
      totalStars: members.reduce((sum, c) => sum + c.totalStars, 0),
      categories: members,
    };
  });

  // Anything the DB knows about but the taxonomy does not (a group renamed in
  // code before the seed re-ran) is surfaced rather than silently dropped.
  for (const [groupSlug, members] of byGroup) {
    const known = GROUP_BY_SLUG.get(groupSlug);
    ordered.push({
      slug: groupSlug,
      name: known?.name ?? groupSlug,
      description: known?.description ?? '',
      repoCount: members.reduce((sum, c) => sum + c.repoCount, 0),
      totalStars: members.reduce((sum, c) => sum + c.totalStars, 0),
      categories: members,
    });
  }

  return ordered;
}

/**
 * Memoised because this is rendered by the header nav, the homepage, /categories
 * AND the filter sidebar on every explorer view — but it is a grouped two-way
 * LEFT JOIN across every primary category assignment in the corpus, plus a
 * percentile_cont that has to sort each category's quality scores. The request-
 * scoped `cache()` wrapper in @/components/data dedupes it *within* one render;
 * this dedupes it *across* requests, which is the part that matters when a
 * crawler is walking the sitemap.
 */
export const getCategoryStats = memoize(loadCategoryStats, AGGREGATE_TTL_MS);

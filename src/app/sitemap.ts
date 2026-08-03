import type { MetadataRoute } from 'next';

import { desc, eq } from 'drizzle-orm';

import { db, repositories } from '@/db';
import { memoize, SITEMAP_TTL_MS } from '@/lib/queries/cache';
import { CATEGORIES } from '@/lib/taxonomy';
import { env } from '@/lib/env';

/**
 * Generated at request time, not build time: it reads the database, and the DB
 * URL is a placeholder during `next build`. force-dynamic keeps the query out
 * of the build, and the try/catch means a transient DB blip degrades to the
 * static + category URLs rather than a 500 that hides the whole sitemap.
 */
export const dynamic = 'force-dynamic';

/**
 * A single sitemap is capped at 50,000 URLs. The corpus (~26k) fits with
 * headroom; ordering by stars means that if it ever crosses 50k, the least
 * important repos are the ones dropped. Past 50k, switch to generateSitemaps().
 */
const REPO_URL_LIMIT = 45_000;

/**
 * The row set is memoised for hours because this is the single heaviest read in
 * the app — 45,000 rows, ordered by stars — and it is requested by crawlers, not
 * by users. Google, Bing and every SEO scraper re-fetch /sitemap.xml on their own
 * schedule and each fetch was paying for the full query. The contents change once
 * a day at most, when the pipeline discovers new repos.
 */
const loadRepoRows = memoize(
  () =>
    db
      .select({
        ownerLogin: repositories.ownerLogin,
        name: repositories.name,
        pushedAt: repositories.githubPushedAt,
        syncedAt: repositories.lastSyncedAt,
      })
      .from(repositories)
      .where(eq(repositories.status, 'active'))
      .orderBy(desc(repositories.stars))
      .limit(REPO_URL_LIMIT),
  SITEMAP_TTL_MS,
);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.siteUrl;
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/repos`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/categories`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/contributors`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/submit`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
  ];

  const categoryRoutes: MetadataRoute.Sitemap = CATEGORIES.map((category) => ({
    url: `${base}/categories/${category.slug}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  let repoRoutes: MetadataRoute.Sitemap = [];
  try {
    const rows = await loadRepoRows();

    repoRoutes = rows.map((row) => ({
      // Encode each path segment: owner/name are GitHub-safe, but encoding keeps
      // a stray character from producing a malformed <loc>.
      url: `${base}/repos/${encodeURIComponent(row.ownerLogin)}/${encodeURIComponent(row.name)}`,
      lastModified: row.syncedAt ?? row.pushedAt ?? now,
      changeFrequency: 'weekly',
      priority: 0.5,
    }));
  } catch (error) {
    console.error('[sitemap] repo query failed, serving static routes only:', error);
  }

  return [...staticRoutes, ...categoryRoutes, ...repoRoutes];
}

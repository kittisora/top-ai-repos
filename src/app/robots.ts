import type { MetadataRoute } from 'next';

import { env } from '@/lib/env';

/**
 * Served at /robots.txt. Allows everything except the JSON API (no value in
 * Google indexing raw endpoints) and points crawlers at the sitemap so the
 * 25k repo pages get discovered without blind crawling.
 *
 * `/repos?*` is disallowed because the explorer keeps every filter in the query
 * string, which is exactly what makes a view shareable — and also what makes the
 * URL space effectively infinite. Sort, category, language, licence, country,
 * star range, quality and page multiply out to millions of combinations — each a
 * near-duplicate of the others, and each costing a filtered query plus the
 * sidebar aggregates to render. Left open, crawlers spend the budget there
 * instead of on the 29k repository pages that hold the unique content.
 *
 * The prefix ends at the `?`, so this blocks only the parameterised views:
 * `/repos` itself, `/repos/owner/name` and every `/categories/[slug]` page stay
 * crawlable. That is the reason the taxonomy is expressed as real paths and only
 * filters live in the query string — the split is what makes this rule safe.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/repos?*'],
    },
    sitemap: `${env.siteUrl}/sitemap.xml`,
    host: env.siteUrl,
  };
}

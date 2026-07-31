import type { MetadataRoute } from 'next';

import { env } from '@/lib/env';

/**
 * Served at /robots.txt. Allows everything except the JSON API (no value in
 * Google indexing raw endpoints) and points crawlers at the sitemap so the
 * 25k repo pages get discovered without blind crawling.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/api/',
    },
    sitemap: `${env.siteUrl}/sitemap.xml`,
    host: env.siteUrl,
  };
}

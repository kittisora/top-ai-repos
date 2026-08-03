/**
 * A tiny in-process TTL memo for the read layer's whole-table aggregates.
 *
 * WHY THIS EXISTS. Every page in this app is `force-dynamic`, so a single view of
 * /repos or /categories/[slug] runs four aggregates that each scan the entire
 * corpus: getGlobalStats (two count(distinct) over ~30k repos), getLanguages and
 * getCountryStats (group-bys over repos and 53k contributors) and
 * getCategoryStats (a two-way LEFT JOIN across every primary assignment). None of
 * those results can change between requests — the ingestion pipeline rewrites
 * them once a day — yet a crawler working through the 29k-URL sitemap re-ran all
 * of them on every hit. That is the bulk of the project's database egress and of
 * its read IO.
 *
 * WHY NOT Next's cache. These functions are also called from the tsx ingestion
 * workers, which run outside a Next request context, and `unstable_cache` is both
 * request-scoped machinery and (as the name says) not a stable contract. A plain
 * module-level memo works identically in both processes and has no framework
 * coupling. The read layer already uses exactly this pattern for the SPDX license
 * index in ./repositories.ts.
 *
 * WHAT IT IS NOT. This is per-process, so a multi-instance deployment holds one
 * copy each — which is fine: the point is collapsing thousands of requests into
 * one query per instance per window, not global coherence.
 */

// Relative, with the extension, rather than the usual `@/lib/env` alias: this
// module has a unit test, and `node --test` resolves TypeScript specifiers itself
// without reading tsconfig's path mappings. env.ts has no imports of its own, so
// the chain stays resolvable under plain Node.
import { env } from '../env.ts';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Wrap a zero-argument loader so its result is reused for `ttlMs`.
 *
 * Concurrent callers that arrive on a cold or expired entry share ONE in-flight
 * promise. That matters more than the caching itself: a crawler burst or a cold
 * deploy would otherwise fire N identical full-table scans in the same instant,
 * which is the exact spike that exhausts a Disk IO budget.
 *
 * A rejected load is never cached — the in-flight promise is cleared and the
 * error propagates to every awaiting caller, so the next request retries. Callers
 * reach these functions through `query()` in @/components/data, which turns the
 * failure into a notice rather than a stack trace.
 */
export function memoize<T>(load: () => Promise<T>, ttlMs: number): () => Promise<T> {
  let entry: Entry<T> | null = null;
  let inFlight: Promise<T> | null = null;

  return function cached(): Promise<T> {
    if (entry && entry.expiresAt > Date.now()) return Promise.resolve(entry.value);
    if (inFlight) return inFlight;

    inFlight = load()
      .then((value) => {
        // Stamped on settle, not on call, so a slow query does not immediately
        // expire the value it just paid for.
        entry = { value, expiresAt: Date.now() + ttlMs };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  };
}

/**
 * Default window for the site-wide aggregates.
 *
 * The underlying data moves once a day, so this could be hours; ten minutes is
 * chosen instead so that a manual `npm run daily` shows up on the site while the
 * operator is still looking at it. Tune with QUERY_CACHE_TTL_SECONDS — 0 disables
 * caching entirely, which is what the ingestion workers effectively want and what
 * you would set while debugging a stats query.
 */
export const AGGREGATE_TTL_MS = env.queryCacheTtlSeconds * 1_000;

/**
 * The sitemap's own window, deliberately much longer.
 *
 * That query pulls 45,000 rows on every request and crawlers re-fetch
 * /sitemap.xml far more often than its contents change. New repos appear once a
 * day at most, so an hours-long window costs nothing in discovery time.
 */
export const SITEMAP_TTL_MS = Math.max(AGGREGATE_TTL_MS, 6 * 60 * 60_000);

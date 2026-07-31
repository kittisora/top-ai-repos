/**
 * The read boundary between pages and the query layer.
 *
 * No `import 'server-only'` here: the package is not installed (Next only
 * vendors it for its own bundler alias) so the bare specifier does not resolve
 * under `tsc --noEmit`. The dynamic `@/db` import below would fail loudly in a
 * client bundle anyway.
 *
 * A brand-new checkout has no .env, no migrations and no rows, and the very
 * first thing the project owner does is `npm run dev` and open the site. If
 * that renders a stack trace we have failed at the only moment that matters, so
 * every page reads through `query()` and gets a discriminated result instead of
 * an exception.
 *
 * The query module is loaded with a dynamic import specifically so that the
 * *module-evaluation* failure is caught too: `@/db` builds its pg Pool at import
 * time from `env.databaseUrl`, which throws when DATABASE_URL is unset. A
 * static import would make that a 500 before any component ran.
 */

import { cache } from 'react';

type QueryModule = typeof import('@/lib/queries');

export type DataErrorKind = 'not-configured' | 'not-migrated' | 'unreachable' | 'unknown';

export interface DataError {
  kind: DataErrorKind;
  /** The underlying message, shown verbatim — it is usually the real answer. */
  detail: string;
}

export type Loaded<T> = { data: T; error: null } | { data: null; error: DataError };

const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNRESET',
  'EAI_AGAIN',
]);

function describe(error: unknown): DataError {
  const detail = error instanceof Error ? error.message : String(error);
  // `code` is on pg's error objects and on Node's system errors, neither of
  // which is typed as anything richer than Error here.
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';

  if (detail.includes('Missing required environment variable')) {
    return { kind: 'not-configured', detail };
  }
  // 42P01 = undefined_table, 3D000 = invalid_catalog_name (database not created).
  if (code === '42P01' || code === '3D000') {
    return { kind: 'not-migrated', detail };
  }
  if (UNREACHABLE_CODES.has(code) || detail.includes('timeout expired')) {
    return { kind: 'unreachable', detail };
  }
  return { kind: 'unknown', detail };
}

/**
 * Two reads happen twice per request and are worth deduplicating explicitly:
 * a detail page runs `generateMetadata` and the component tree in the same
 * pass, and a category page needs the same aggregate as the explorer nested
 * inside it. React's `cache` memoises for the lifetime of one request only, so
 * there is no staleness to reason about — it is purely a round-trip saving.
 *
 * `query` itself cannot be memoised: its argument is a closure, which is never
 * equal between calls.
 */
export const loadRepository = cache((fullName: string) =>
  query((q) => q.getRepositoryByFullName(fullName)),
);

export const loadCategoryStats = cache(() => query((q) => q.getCategoryStats()));

export async function query<T>(run: (q: QueryModule) => Promise<T>): Promise<Loaded<T>> {
  try {
    const q = await import('@/lib/queries');
    return { data: await run(q), error: null };
  } catch (error) {
    // Logged rather than swallowed: the visitor gets guidance, the operator
    // still gets the stack in the server console.
    console.error('[ailist] query failed:', error);
    return { data: null, error: describe(error) };
  }
}

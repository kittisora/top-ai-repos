import 'server-only';

import { env } from '@/lib/env';
// Deep import rather than `@/lib/queries`: the barrel pulls in the database
// client, and this module is reached from the root layout on every request.
import { memoize } from '@/lib/queries/cache';

const API_VERSION = '2022-11-28';

/**
 * One hour, in BOTH caches in front of this call, for two different reasons.
 *
 * `next: { revalidate }` on the fetch is what keeps the badge from turning pages
 * dynamic. The header renders from the root layout, so this call lands inside
 * every route in the app — including the two (/submit and the 404) that Next
 * prerenders. An uncached fetch there is a `DynamicServerError`: those pages stop
 * being static.
 *
 * The module-level memo is the same pattern, and the same reasoning, as
 * @/lib/queries/cache: it does not depend on route-segment config (most pages are
 * `force-dynamic`, which flips the default of `fetch` to no-store), and its
 * in-flight sharing collapses a crawler burst on a cold instance into ONE call to
 * GitHub rather than one per request — which matters at 60 unauthenticated
 * requests per hour.
 */
const STARS_TTL_MS = 60 * 60_000;
const STARS_REVALIDATE_SECONDS = STARS_TTL_MS / 1_000;

/** GitHub's own limit on the shape of an owner or repository name. */
const REPOSITORY_PART = /^[a-z0-9_.-]+$/i;

const TIMEOUT_MS = 5_000;

/**
 * Read one repository's star count. Throws on anything other than a usable
 * answer, which is what keeps a failure OUT of the memo below (a rejected load
 * is never cached) so the next request retries instead of showing a blank badge
 * for an hour.
 */
async function fetchStars(fullName: string): Promise<number> {
  const [owner, repo, extra] = fullName.split('/');
  if (
    extra !== undefined ||
    !owner ||
    !repo ||
    !REPOSITORY_PART.test(owner) ||
    !REPOSITORY_PART.test(repo)
  ) {
    throw new Error(`Not a repository slug: ${fullName}`);
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
    // MANDATORY — GitHub rejects requests without a User-Agent outright.
    'User-Agent': 'top-ai-repos/1.0',
  };
  // Optional on purpose: the token is required for ingestion, not for serving.
  // Without it this is one unauthenticated call per hour per instance, well
  // inside the 60/hour an IP gets; with it, it comes out of the 5,000.
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers,
    next: { revalidate: STARS_REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} for ${fullName}`);
  }

  const body = (await response.json()) as { stargazers_count?: unknown };
  const stars = body.stargazers_count;
  if (typeof stars !== 'number' || !Number.isFinite(stars)) {
    throw new Error(`No stargazers_count in the payload for ${fullName}`);
  }
  return stars;
}

const load = memoize(() => fetchStars(env.sourceRepo), STARS_TTL_MS);

/**
 * Star count for this project's own repository, for the header badge.
 *
 * Returns null rather than throwing when GitHub is unreachable, rate-limited or
 * the slug is wrong: the badge is decoration, and a link to the repo with no
 * number beside it is a perfectly good fallback.
 */
export async function getSourceRepoStars(): Promise<number | null> {
  try {
    return await load();
  } catch (error) {
    console.warn(
      `[github] star count for ${env.sourceRepo} unavailable: ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return null;
  }
}

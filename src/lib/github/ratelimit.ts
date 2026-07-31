import { sleep } from '@/lib/utils';
import type { BucketState, RateLimitState } from './types';

/**
 * The three budgets we meter. GitHub also reports `code_search` and
 * `integration_manifest`; we never touch those endpoints, so responses naming
 * them are ignored rather than folded into `core` (folding would corrupt the
 * core accounting).
 */
export type RateResource = 'core' | 'search' | 'graphql';

const RESOURCES: readonly RateResource[] = ['core', 'search', 'graphql'];

/** Sentinel for "no response observed yet" — 0 would mean "exhausted". */
const UNKNOWN = -1;

interface MutableBucket {
  remaining: number;
  limit: number;
  resetAt: Date | null;
  /** Whether any response has ever reported `x-ratelimit-remaining` for this
   * bucket. Once it has, header truth always wins over local accounting. */
  headerSeen: boolean;
}

/** Documented PAT budget, used only to seed local accounting if GitHub ever
 * stops sending the headers. */
const GRAPHQL_DEFAULT_POINTS = 5_000;

function num(raw: string | null): number | null {
  if (raw === null || raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function isResource(value: string | null): value is RateResource {
  return value !== null && (RESOURCES as readonly string[]).includes(value);
}

/**
 * Tracks the three buckets purely from the `x-ratelimit-*` headers that ride on
 * every response. We never poll `GET /rate_limit`: it is free of core quota but
 * NOT of secondary limits, so polling it in a loop is itself a way to get
 * throttled.
 */
export class RateLimiter {
  private readonly buckets: Record<RateResource, MutableBucket> = {
    core: { remaining: UNKNOWN, limit: UNKNOWN, resetAt: null, headerSeen: false },
    search: { remaining: UNKNOWN, limit: UNKNOWN, resetAt: null, headerSeen: false },
    graphql: { remaining: UNKNOWN, limit: UNKNOWN, resetAt: null, headerSeen: false },
  };

  /**
   * Fold one response's headers into the right bucket.
   *
   * `fallback` is used only when the response carries no `x-ratelimit-resource`
   * (error pages served by the edge sometimes drop it).
   */
  observe(headers: Headers, fallback: RateResource): void {
    const named = headers.get('x-ratelimit-resource');
    const bucket = this.buckets[isResource(named) ? named : fallback];

    const remaining = num(headers.get('x-ratelimit-remaining'));
    const limit = num(headers.get('x-ratelimit-limit'));
    // Epoch SECONDS, not milliseconds — the single most common bug here.
    const reset = num(headers.get('x-ratelimit-reset'));

    if (limit !== null) bucket.limit = limit;
    if (reset !== null) bucket.resetAt = new Date(reset * 1000);
    if (remaining !== null) {
      bucket.remaining = remaining;
      bucket.headerSeen = true;
    }
  }

  /**
   * Charge a GraphQL query's `data.rateLimit.cost` against the points bucket.
   *
   * This is a FALLBACK only. Every GraphQL response carries
   * `x-ratelimit-remaining`, and that value is already net of the query being
   * answered — applying the cost on top of it would double-count, so the header
   * wins whenever it has ever been seen.
   */
  spendGraphqlPoints(cost: number): void {
    const bucket = this.buckets.graphql;
    if (bucket.headerSeen || cost <= 0) return;
    if (bucket.remaining === UNKNOWN) {
      bucket.limit = GRAPHQL_DEFAULT_POINTS;
      bucket.remaining = GRAPHQL_DEFAULT_POINTS;
    }
    bucket.remaining = Math.max(0, bucket.remaining - cost);
  }

  /**
   * Pre-flight wait. If we already know the bucket is empty, sleeping here is
   * strictly better than issuing a request that is certain to come back 403 and
   * then sleeping anyway — a burned request still counts against the secondary
   * limiter.
   */
  async awaitBudget(resource: RateResource): Promise<void> {
    const bucket = this.buckets[resource];
    if (bucket.remaining !== 0 || bucket.resetAt === null) return;

    const waitMs = bucket.resetAt.getTime() - Date.now() + 1_000;
    if (waitMs > 0) await sleep(waitMs);
    // The window has rolled over; force the next response to re-establish truth.
    bucket.remaining = UNKNOWN;
  }

  snapshot(): RateLimitState {
    const copy = (b: MutableBucket): BucketState => ({
      remaining: b.remaining,
      limit: b.limit,
      resetAt: b.resetAt === null ? null : new Date(b.resetAt.getTime()),
    });
    return {
      core: copy(this.buckets.core),
      search: copy(this.buckets.search),
      graphql: copy(this.buckets.graphql),
    };
  }
}

/**
 * Backoff step 1: `retry-after` is in SECONDS and outranks everything else.
 */
export function retryAfterMs(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw === null) return null;
  const seconds = Number(raw);
  // GitHub sends a plain integer; an HTTP-date is legal per RFC but unused here.
  if (!Number.isFinite(seconds)) return null;
  return Math.max(0, seconds) * 1_000 + 500;
}

/**
 * Backoff step 2: `x-ratelimit-remaining: 0` is a PRIMARY limit — sleep until
 * `x-ratelimit-reset` (epoch seconds) plus a second of slack.
 */
export function primaryResetMs(headers: Headers): number | null {
  if (headers.get('x-ratelimit-remaining') !== '0') return null;
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (!Number.isFinite(reset)) return 60_000;
  return Math.max(1_000, reset * 1_000 - Date.now() + 1_000);
}

/**
 * Backoff step 3: secondary limits. The docs mandate "at least one minute",
 * then exponentially increasing. Jitter keeps parallel workers from
 * re-colliding on the same second.
 */
export function secondaryBackoffMs(attempt: number): number {
  return 60_000 * 2 ** attempt + Math.random() * 1_000;
}

/** Transport hiccups and 5xx: fast jittered exponential, capped at 30s. */
export function transientBackoffMs(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 500;
}

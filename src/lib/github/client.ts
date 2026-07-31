import { env } from '@/lib/env';
import { chunk, mapLimit, sleep } from '@/lib/utils';
import { GitHubError, GitHubTooHeavyError } from './errors';
import {
  buildAliasedRepoQuery,
  buildNodesQuery,
  README_ALIASES,
  type GqlAliasedRepoResponse,
  type GqlError,
  type GqlNodesResponse,
  type GqlRateLimit,
  type GqlRepo,
} from './queries';
import {
  primaryResetMs,
  RateLimiter,
  retryAfterMs,
  secondaryBackoffMs,
  transientBackoffMs,
  type RateResource,
} from './ratelimit';
import type {
  BulkFetchOptions,
  ContributorCountResult,
  GitHubClientOptions,
  GitHubUserProfile,
  GraphRepo,
  RateLimitState,
  RepoLookupResult,
  SearchOptions,
  SearchRepoItem,
  SearchResult,
  TopContributor,
} from './types';

const API = 'https://api.github.com';
const GRAPHQL_URL = `${API}/graphql`;

/** MANDATORY — GitHub rejects requests without a User-Agent outright. */
const DEFAULT_USER_AGENT = 'ailist-ingest/1.0';

/**
 * 2022-11-28 is not the newest version (2026-03-10 exists) but it IS the
 * default and is supported through at least March 2028. Opting into
 * 2026-03-10 is all-or-nothing and pulls in 22 breaking changes.
 */
const API_VERSION = '2022-11-28';

const MAX_ATTEMPTS = 5;

/**
 * 30 search requests/MINUTE with zero slack is exactly how you trip the
 * secondary limiter. 2,100ms leaves ~5% headroom on a 2,000ms budget.
 */
const SEARCH_SPACING_MS = 2_100;

/** Below GitHub's 10s server timeout: a server-side timeout deducts extra
 * points from the hourly budget for the NEXT hour, so failing fast client-side
 * is strictly cheaper than letting GitHub kill it. */
const GRAPHQL_TIMEOUT_MS = 9_000;

const REST_TIMEOUT_MS = 20_000;

/**
 * README blobs are unbounded, so a query pulling them for many repos routinely
 * blows the 9s client timeout. 10 keeps a with-README query returning in time;
 * an over-heavy one still halves via splitOrGiveUp, and a batch that fails
 * outright is isolated (see fetchBatchIsolated) so only its repos fall to REST.
 */
const GRAPHQL_BATCH_WITH_README = 10;
const GRAPHQL_BATCH_PLAIN = 50;

/**
 * The Link-header contributor count saturates BELOW 500 (GitHub resolves only
 * the first 500 author EMAIL addresses, which then dedupe to fewer users).
 * Measured ceilings: rust-lang/rust 441, vuejs/core 438, kubernetes 350,
 * vscode 321. A >=495 threshold would never fire.
 */
const CONTRIBUTOR_SATURATION = 300;

/** Link URLs come back in NUMERIC repo-id form
 * (`/repositories/70107786/contributors?per_page=1&page=425`), so anchoring on
 * `/repos/{owner}/{repo}/` silently never matches and the count becomes 1. */
const LAST_PAGE_RE = /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/;

const YEAR_MS = 365 * 86_400_000;

type RequestMode = 'rest' | 'graphql';

interface RequestOptions {
  resource: RateResource;
  mode: RequestMode;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Slot-passing semaphore: `release` hands its slot straight to the next waiter
 * instead of decrementing, so a caller arriving between the decrement and the
 * waiter's resumption cannot over-subscribe the limit.
 */
class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/** GitHub puts the entire diagnosis in the body `message`; a bare status is useless. */
async function readMessage(res: Response): Promise<string> {
  let text: string;
  try {
    text = await res.clone().text();
  } catch {
    return '';
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && 'message' in parsed) {
      const message = (parsed as { message: unknown }).message;
      if (typeof message === 'string') return message;
    }
  } catch {
    /* not JSON — fall through to raw text */
  }
  return text.slice(0, 300);
}

/** The /contributors failure on huge-history repos (torvalds/linux). It is a
 * 403 but it is NOT a rate limit, and a generic 403 handler misclassifies it
 * into a pointless 60s backoff. */
function isContributorsTooLarge(message: string): boolean {
  return /too large to list contributors/i.test(message);
}

interface RawOwner {
  login?: string;
  id?: number;
  type?: string;
  avatar_url?: string;
}

interface RawRepo {
  id?: number;
  node_id?: string;
  full_name?: string;
  name?: string;
  owner?: RawOwner | null;
  description?: string | null;
  homepage?: string | null;
  language?: string | null;
  topics?: string[] | null;
  license?: { spdx_id?: string | null; name?: string | null } | null;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  watchers_count?: number;
  size?: number;
  default_branch?: string;
  archived?: boolean;
  fork?: boolean;
  is_template?: boolean;
  created_at?: string;
  updated_at?: string;
  pushed_at?: string | null;
}

/**
 * Normalize a REST repo object. Defensive defaults exist because the 2026-03-10
 * API version removes fields from this payload and because `pushed_at` is null
 * on empty repos — the parser must tolerate both shapes rather than assume one.
 */
function toSearchRepoItem(raw: RawRepo): SearchRepoItem {
  return {
    id: raw.id ?? 0,
    node_id: raw.node_id ?? '',
    full_name: raw.full_name ?? '',
    name: raw.name ?? '',
    owner: {
      login: raw.owner?.login ?? '',
      id: raw.owner?.id ?? 0,
      type: raw.owner?.type ?? 'User',
      avatar_url: raw.owner?.avatar_url ?? '',
    },
    description: raw.description ?? null,
    homepage: raw.homepage ?? null,
    language: raw.language ?? null,
    topics: raw.topics ?? [],
    license: raw.license
      ? { spdx_id: raw.license.spdx_id ?? null, name: raw.license.name ?? null }
      : null,
    stargazers_count: raw.stargazers_count ?? 0,
    forks_count: raw.forks_count ?? 0,
    open_issues_count: raw.open_issues_count ?? 0,
    watchers_count: raw.watchers_count ?? 0,
    size: raw.size ?? 0,
    default_branch: raw.default_branch ?? 'main',
    archived: raw.archived ?? false,
    fork: raw.fork ?? false,
    is_template: raw.is_template ?? false,
    created_at: raw.created_at ?? '',
    updated_at: raw.updated_at ?? '',
    pushed_at: raw.pushed_at ?? raw.updated_at ?? '',
  };
}

function pickReadme(repo: GqlRepo): string | null {
  for (const alias of README_ALIASES) {
    const blob = repo[alias];
    // isBinary is itself nullable; text is null for binaries. Truncated blobs
    // still carry usable leading text, so we keep them.
    if (blob && blob.isBinary !== true && typeof blob.text === 'string' && blob.text.length > 0) {
      return blob.text;
    }
  }
  return null;
}

function countRecentReleases(repo: GqlRepo): number | null {
  const nodes = repo.releases?.nodes;
  if (!nodes) return null;
  const cutoff = Date.now() - YEAR_MS;
  let count = 0;
  for (const node of nodes) {
    if (!node || node.isDraft) continue;
    const stamp = Date.parse(node.publishedAt ?? node.createdAt);
    if (Number.isFinite(stamp) && stamp >= cutoff) count++;
  }
  return count;
}

function toGraphRepo(repo: GqlRepo): GraphRepo {
  const topics = (repo.repositoryTopics?.nodes ?? [])
    .map((node) => node?.topic?.name)
    .filter((name): name is string => typeof name === 'string');

  return {
    nodeId: repo.id,
    githubId: repo.databaseId ?? null,
    fullName: repo.nameWithOwner,
    ownerLogin: repo.owner?.login ?? repo.nameWithOwner.split('/')[0] ?? '',
    name: repo.name,
    description: repo.description ?? null,
    homepage: repo.homepageUrl ?? null,
    language: repo.primaryLanguage?.name ?? null,
    topics,
    licenseSpdxId: repo.licenseInfo?.spdxId ?? null,
    licenseName: repo.licenseInfo?.name ?? null,
    stars: repo.stargazerCount,
    forks: repo.forkCount,
    openIssues: repo.openIssues?.totalCount ?? 0,
    watchers: repo.watchers?.totalCount ?? 0,
    // diskUsage is in KILOBYTES and matches the REST `size` field's unit.
    sizeKb: repo.diskUsage ?? 0,
    defaultBranch: repo.defaultBranchRef?.name ?? null,
    isArchived: repo.isArchived,
    isFork: repo.isFork,
    isTemplate: repo.isTemplate,
    ownerType: repo.owner?.__typename ?? null,
    ownerAvatarUrl: repo.owner?.avatarUrl ?? null,
    ownerLocation: repo.owner?.location ?? null,
    createdAt: repo.createdAt ?? null,
    pushedAt: repo.pushedAt ?? null,
    updatedAt: repo.updatedAt ?? null,
    latestReleaseTag: repo.latestRelease?.tagName ?? null,
    latestReleaseAt: repo.latestRelease?.publishedAt ?? repo.latestRelease?.createdAt ?? null,
    releasesLastYear: countRecentReleases(repo),
    readme: pickReadme(repo),
  };
}

function isGqlRepo(value: unknown): value is GqlRepo {
  return typeof value === 'object' && value !== null && 'nameWithOwner' in value;
}

function isResourceLimited(errors: GqlError[]): boolean {
  return errors.some(
    (e) => e.type === 'RESOURCE_LIMITS_EXCEEDED' || /resource limits/i.test(e.message ?? ''),
  );
}

export class GitHubClient {
  private readonly token: string;
  private readonly userAgent: string;
  private readonly concurrency: number;
  private readonly limiter = new RateLimiter();
  private readonly semaphore: Semaphore;

  /** Tail of the serialized search chain. Resolves 2.1s after the previous
   * search call completed, which is what enforces the spacing. */
  private searchChain: Promise<void> = Promise.resolve();

  constructor(opts: GitHubClientOptions = {}) {
    // Reading env.githubToken here (not at module load) keeps importing this
    // module cheap and side-effect free — the getter throws when unset.
    this.token = opts.token ?? env.githubToken;
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.concurrency = Math.max(1, opts.concurrency ?? env.githubConcurrency);
    this.semaphore = new Semaphore(this.concurrency);
  }

  rateLimitState(): RateLimitState {
    return this.limiter.snapshot();
  }

  /* ---------------------------------------------------------------- *
   * Transport
   * ---------------------------------------------------------------- */

  private baseHeaders(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': this.userAgent,
      Authorization: `Bearer ${this.token}`,
    };
  }

  /**
   * One request with the full documented backoff policy applied.
   *
   * Returns the Response for the caller to interpret — including 4xx that are
   * NOT rate limits (404, 422-shard-cap, the /contributors 403). Only genuinely
   * unrecoverable transport failures throw from here.
   */
  private async request(url: string, opts: RequestOptions): Promise<Response> {
    const timeoutMs = opts.timeoutMs ?? REST_TIMEOUT_MS;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await this.limiter.awaitBudget(opts.resource);

      let res: Response;
      try {
        res = await this.semaphore.run(() =>
          fetch(url, {
            method: opts.method ?? 'GET',
            headers: { ...this.baseHeaders(), ...opts.headers },
            body: opts.body,
            // Renamed repos answer 301 with a Location to the canonical
            // numeric-id URL; not following yields an empty body and a null row.
            redirect: 'follow',
            signal: AbortSignal.timeout(timeoutMs),
          }),
        );
      } catch (error) {
        if (isAbort(error) && opts.mode === 'graphql') {
          throw new GitHubTooHeavyError(0, `client timeout after ${timeoutMs}ms`, url);
        }
        if (attempt === MAX_ATTEMPTS - 1) {
          throw new GitHubError(0, error instanceof Error ? error.message : String(error), url);
        }
        await sleep(transientBackoffMs(attempt));
        continue;
      }

      this.limiter.observe(res.headers, opts.resource);

      if (res.status === 502 || res.status === 503 || res.status === 504) {
        // For GraphQL this means "the query was too heavy" — the caller halves
        // the batch. Retrying it unchanged would burn extra points for an hour.
        if (opts.mode === 'graphql') return res;
        if (attempt === MAX_ATTEMPTS - 1) return res;
        await sleep(transientBackoffMs(attempt));
        continue;
      }

      if (res.status !== 403 && res.status !== 429) return res;

      // 403/429 cover BOTH primary and secondary limits and genuine permission
      // errors; the status alone cannot tell them apart.
      const message = await readMessage(res);
      if (isContributorsTooLarge(message)) return res;

      // (a) retry-after outranks everything, and is in SECONDS.
      const afterMs = retryAfterMs(res.headers);
      if (afterMs !== null) {
        await sleep(afterMs);
        continue;
      }

      // (b) remaining === 0 is the PRIMARY limit: sleep to the reset epoch.
      const resetMs = primaryResetMs(res.headers);
      if (resetMs !== null) {
        await sleep(resetMs);
        continue;
      }

      // (c) secondary limit: at least a minute, then exponential.
      if (/secondary rate limit/i.test(message)) {
        await sleep(secondaryBackoffMs(attempt));
        continue;
      }

      // (d) 403/429 with remaining > 0 and no secondary message is a real
      // permission error. Retrying it can only get the integration banned.
      return res;
    }

    throw new GitHubError(429, `gave up after ${MAX_ATTEMPTS} rate-limit retries`, url);
  }

  /**
   * Serialize every search call through a single lane with 2.1s spacing.
   *
   * The caller's promise settles as soon as the request does; only the NEXT
   * search waits out the spacing, so the delay never shows up as latency for
   * the current call.
   */
  private enqueueSearch<T>(fn: () => Promise<T>): Promise<T> {
    const gate = this.searchChain;
    let openNext!: () => void;
    this.searchChain = new Promise<void>((resolve) => {
      openNext = resolve;
    });

    return (async () => {
      await gate;
      try {
        return await fn();
      } finally {
        void sleep(SEARCH_SPACING_MS).then(openNext);
      }
    })();
  }

  /* ---------------------------------------------------------------- *
   * REST
   * ---------------------------------------------------------------- */

  async searchRepositories(query: string, opts: SearchOptions = {}): Promise<SearchResult> {
    // per_page > 100 silently CLAMPS rather than erroring, so clamp locally and
    // always trust items.length over the requested page size.
    const params = new URLSearchParams({
      q: query,
      per_page: String(Math.min(100, Math.max(1, opts.perPage ?? 100))),
      page: String(Math.max(1, opts.page ?? 1)),
    });
    if (opts.sort) params.set('sort', opts.sort);
    if (opts.order) params.set('order', opts.order);
    const url = `${API}/search/repositories?${params.toString()}`;

    return this.enqueueSearch(async () => {
      const res = await this.request(url, { resource: 'search', mode: 'rest' });

      if (res.status === 422) {
        const message = await readMessage(res);
        // The 1,000-result wall is enforced as a 422 on the PAGE request. It is
        // a shard-harder signal, not an error: total_count (uncapped) tells the
        // caller by how much.
        if (/only the first 1000 search results/i.test(message)) {
          return { totalCount: 0, items: [], incompleteResults: false, capped: true };
        }
        throw new GitHubError(422, message, url);
      }
      if (!res.ok) throw new GitHubError(res.status, await readMessage(res), url);

      const body = (await res.json()) as {
        total_count?: number;
        incomplete_results?: boolean;
        items?: RawRepo[];
      };

      return {
        totalCount: body.total_count ?? 0,
        items: (body.items ?? []).map(toSearchRepoItem),
        // true => GitHub timed out and returned PARTIAL matches. The payload
        // looks completely valid; ignoring this silently loses repos.
        incompleteResults: body.incomplete_results ?? false,
        capped: false,
      };
    });
  }

  /**
   * Conditional fetch of a single repo. A 304 costs NO primary quota — but only
   * because we always send Authorization; an unauthenticated 304 still
   * increments x-ratelimit-used.
   */
  async getRepoByFullName(fullName: string, etag?: string | null): Promise<RepoLookupResult> {
    const url = `${API}/repos/${fullName}`;
    // The ETag must be echoed back VERBATIM, including the W/ prefix and quotes.
    const headers = etag ? { 'If-None-Match': etag } : undefined;
    const res = await this.request(url, { resource: 'core', mode: 'rest', headers });

    if (res.status === 304) return { status: 'not-modified' };
    // 410 (deleted) and 451 (legally blocked) are terminal in the same way a 404
    // is: the repo will never come back under this name.
    if (res.status === 404 || res.status === 410 || res.status === 451) return { status: 'gone' };
    if (!res.ok) throw new GitHubError(res.status, await readMessage(res), url);

    const raw = (await res.json()) as RawRepo;
    return { status: 'ok', repo: toSearchRepoItem(raw), etag: res.headers.get('etag') };
  }

  async getContributorCount(fullName: string): Promise<ContributorCountResult> {
    const url = `${API}/repos/${fullName}/contributors?per_page=1`;
    const res = await this.request(url, { resource: 'core', mode: 'rest' });

    if (res.status === 204) return { count: 0, truncated: false }; // empty repository
    if (res.status === 404) return { count: null, truncated: false };
    if (res.status === 403) {
      const message = await readMessage(res);
      if (isContributorsTooLarge(message)) return { count: null, truncated: true };
      throw new GitHubError(403, message, url);
    }
    if (!res.ok) throw new GitHubError(res.status, await readMessage(res), url);

    const link = res.headers.get('link');
    if (!link) {
      // No Link header means a single page: 0 or 1 contributor.
      const body = (await res.json()) as unknown[];
      const count = Array.isArray(body) ? body.length : 0;
      return { count, truncated: false };
    }

    const match = LAST_PAGE_RE.exec(link);
    const count = match ? Number(match[1]) : 1;
    return { count, truncated: count >= CONTRIBUTOR_SATURATION };
  }

  async getTopContributors(fullName: string, limit = 10): Promise<TopContributor[]> {
    const perPage = Math.min(100, Math.max(1, limit));
    const url = `${API}/repos/${fullName}/contributors?per_page=${perPage}`;
    const res = await this.request(url, { resource: 'core', mode: 'rest' });

    if (res.status === 204 || res.status === 404) return [];
    if (res.status === 403 && isContributorsTooLarge(await readMessage(res))) return [];
    if (!res.ok) throw new GitHubError(res.status, await readMessage(res), url);

    const body = (await res.json()) as {
      login?: string;
      id?: number;
      avatar_url?: string | null;
      contributions?: number;
      type?: string;
    }[];

    return body
      // Anonymous entries (type: "Anonymous") have no login and no user id.
      .filter((row) => typeof row.login === 'string' && row.login.length > 0)
      .slice(0, limit)
      .map((row) => ({
        login: row.login as string,
        id: row.id ?? 0,
        avatarUrl: row.avatar_url ?? null,
        contributions: row.contributions ?? 0,
      }));
  }

  async getUser(login: string): Promise<GitHubUserProfile | null> {
    const url = `${API}/users/${encodeURIComponent(login)}`;
    const res = await this.request(url, { resource: 'core', mode: 'rest' });

    if (res.status === 404) return null;
    if (!res.ok) throw new GitHubError(res.status, await readMessage(res), url);

    const body = (await res.json()) as {
      id?: number;
      login?: string;
      name?: string | null;
      avatar_url?: string | null;
      company?: string | null;
      blog?: string | null;
      location?: string | null;
      followers?: number;
      public_repos?: number;
    };

    return {
      id: body.id ?? 0,
      login: body.login ?? login,
      name: body.name ?? null,
      avatarUrl: body.avatar_url ?? null,
      company: body.company ?? null,
      // GitHub returns '' rather than null for an unset blog.
      blog: body.blog ? body.blog : null,
      location: body.location ?? null,
      followers: body.followers ?? 0,
      publicRepos: body.public_repos ?? 0,
    };
  }

  /**
   * REST is the better README source than GraphQL `object()`: it resolves
   * whatever the repo actually calls its readme (case, extension and directory
   * variants alike) instead of probing fixed case-sensitive paths.
   */
  async getReadme(fullName: string): Promise<string | null> {
    const url = `${API}/repos/${fullName}/readme`;
    const res = await this.request(url, {
      resource: 'core',
      mode: 'rest',
      // The docs claim raw is the default; it is NOT — without this header you
      // get a JSON envelope with base64 `content`.
      headers: { Accept: 'application/vnd.github.raw+json' },
    });

    if (res.status === 404) return null; // no README — entirely normal
    if (!res.ok) throw new GitHubError(res.status, await readMessage(res), url);
    return res.text();
  }

  /* ---------------------------------------------------------------- *
   * GraphQL
   * ---------------------------------------------------------------- */

  private async graphql<T extends { rateLimit?: GqlRateLimit | null }>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<{ data: T | null; errors: GqlError[] }> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const res = await this.request(GRAPHQL_URL, {
        resource: 'graphql',
        mode: 'graphql',
        method: 'POST',
        body: JSON.stringify({ query, variables }),
        headers: {
          'Content-Type': 'application/json',
          // Forces the short modern node-ID form (R_kgDO…) instead of the
          // closing-down base64 one, for EVERY id field in the response.
          'X-Github-Next-Global-ID': '1',
        },
        timeoutMs: GRAPHQL_TIMEOUT_MS,
      });

      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new GitHubTooHeavyError(res.status, 'server timeout — halve the batch', GRAPHQL_URL);
      }
      if (!res.ok) throw new GitHubError(res.status, await readMessage(res), GRAPHQL_URL);

      // HTTP 200 does NOT mean success: primary-limit exhaustion, the Sept-2025
      // resource limiter and per-alias failures all arrive as 200.
      const body = (await res.json()) as { data?: T | null; errors?: GqlError[] };
      const errors = body.errors ?? [];

      if (isResourceLimited(errors)) {
        throw new GitHubTooHeavyError(200, 'RESOURCE_LIMITS_EXCEEDED', GRAPHQL_URL);
      }
      if (errors.some((e) => e.type === 'RATE_LIMITED')) {
        // Primary exhaustion arrives as HTTP 200 with remaining: 0. The limiter
        // has already recorded that from the headers, so the next iteration's
        // pre-flight wait sleeps to the reset instead of guessing; only a
        // secondary limit (remaining still > 0) needs the exponential backoff.
        if (this.limiter.snapshot().graphql.remaining !== 0) {
          await sleep(secondaryBackoffMs(attempt));
        }
        continue;
      }

      const cost = body.data?.rateLimit?.cost;
      // No-ops whenever the response headers already reported remaining, which
      // they always do — see RateLimiter.spendGraphqlPoints.
      if (typeof cost === 'number') this.limiter.spendGraphqlPoints(cost);

      // Remaining errors (NOT_FOUND for one alias, SAML enforcement) ship
      // alongside USABLE partial data — never discard the batch over them.
      return { data: body.data ?? null, errors };
    }

    throw new GitHubError(200, `RATE_LIMITED after ${MAX_ATTEMPTS} attempts`, GRAPHQL_URL);
  }

  /**
   * Bulk metadata by node ID. Batches are auto-sized and HALVED on a
   * too-heavy response rather than retried unchanged.
   */
  async getReposByNodeIds(nodeIds: string[], opts: BulkFetchOptions = {}): Promise<GraphRepo[]> {
    const includeReadme = opts.includeReadme ?? true;
    const batches = chunk(
      nodeIds,
      includeReadme ? GRAPHQL_BATCH_WITH_README : GRAPHQL_BATCH_PLAIN,
    );
    const results = await mapLimit(batches, this.concurrency, (batch) =>
      this.fetchBatchIsolated(batch.length, () => this.fetchNodeBatch(batch, includeReadme)),
    );
    return results.flat();
  }

  /**
   * Run one batch so its failure cannot sink the sibling batches. A client
   * timeout or a repeatedly-too-heavy query returns [] for just this batch;
   * those repos then fall through to the caller's REST fallback, which is the
   * designed safety net for "GraphQL did not return X". A genuine auth error
   * (401 / permission 403) is rethrown — that is not a per-batch problem and
   * should stop the run rather than silently degrade every batch to REST.
   */
  private async fetchBatchIsolated(
    size: number,
    run: () => Promise<GraphRepo[]>,
  ): Promise<GraphRepo[]> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof GitHubError && (error.status === 401 || error.status === 403)) {
        throw error;
      }
      console.warn(
        `[github] graphql batch of ${size} fell back to REST: ` +
          (error instanceof Error ? error.message : String(error)),
      );
      return [];
    }
  }

  private async fetchNodeBatch(ids: string[], includeReadme: boolean): Promise<GraphRepo[]> {
    if (ids.length === 0) return [];
    try {
      const { data } = await this.graphql<GqlNodesResponse>(buildNodesQuery(includeReadme), {
        ids,
      });
      // Elements are nullable and returned in input order — a deleted or
      // access-revoked repo yields null at its index while the rest survive.
      return (data?.nodes ?? [])
        .filter((node): node is GqlRepo => isGqlRepo(node))
        .map(toGraphRepo);
    } catch (error) {
      return this.splitOrGiveUp(error, ids, (half) => this.fetchNodeBatch(half, includeReadme));
    }
  }

  /**
   * Bulk metadata by "owner/name", via an aliased query. Stale names resolve
   * through renames (repository(followRenames:) defaults to true), so callers
   * must re-key on the returned `fullName` / `githubId`.
   */
  async getReposByFullNames(
    fullNames: string[],
    opts: BulkFetchOptions = {},
  ): Promise<GraphRepo[]> {
    const includeReadme = opts.includeReadme ?? true;
    const pairs = fullNames
      .map((fullName) => {
        const slash = fullName.indexOf('/');
        if (slash <= 0) return null;
        return { owner: fullName.slice(0, slash), name: fullName.slice(slash + 1) };
      })
      .filter((pair): pair is { owner: string; name: string } => pair !== null);

    const batches = chunk(pairs, includeReadme ? GRAPHQL_BATCH_WITH_README : GRAPHQL_BATCH_PLAIN);
    const results = await mapLimit(batches, this.concurrency, (batch) =>
      this.fetchBatchIsolated(batch.length, () => this.fetchAliasBatch(batch, includeReadme)),
    );
    return results.flat();
  }

  private async fetchAliasBatch(
    pairs: { owner: string; name: string }[],
    includeReadme: boolean,
  ): Promise<GraphRepo[]> {
    if (pairs.length === 0) return [];
    try {
      const variables: Record<string, unknown> = {};
      pairs.forEach((pair, i) => {
        variables[`o${i}`] = pair.owner;
        variables[`n${i}`] = pair.name;
      });

      const { data } = await this.graphql<GqlAliasedRepoResponse>(
        buildAliasedRepoQuery(pairs.length, includeReadme),
        variables,
      );
      if (!data) return [];

      const out: GraphRepo[] = [];
      for (let i = 0; i < pairs.length; i++) {
        const node = data[`r${i}`];
        // A null alias means an error covered that path (NOT_FOUND, SAML). It is
        // never "the repo has zero stars" — skip it, do not write zeros.
        if (isGqlRepo(node)) out.push(toGraphRepo(node));
      }
      return out;
    } catch (error) {
      return this.splitOrGiveUp(error, pairs, (half) => this.fetchAliasBatch(half, includeReadme));
    }
  }

  /**
   * The documented response to a too-heavy query: halve and re-run the halves
   * sequentially. A single item that is still too heavy (a repo with a giant
   * README, say) is dropped rather than allowed to stall the whole sync.
   */
  private async splitOrGiveUp<T>(
    error: unknown,
    items: T[],
    run: (half: T[]) => Promise<GraphRepo[]>,
  ): Promise<GraphRepo[]> {
    if (!(error instanceof GitHubTooHeavyError)) throw error;
    if (items.length <= 1) {
      console.warn(`[github] dropping 1 repo that GitHub could not serve: ${error.message}`);
      return [];
    }
    const mid = Math.ceil(items.length / 2);
    const first = await run(items.slice(0, mid));
    const second = await run(items.slice(mid));
    return [...first, ...second];
  }
}

let shared: GitHubClient | null = null;

/** Explicit accessor for callers that want to force construction (and see the
 * missing-token error) at a point of their choosing. */
export function getGitHubClient(): GitHubClient {
  shared ??= new GitHubClient();
  return shared;
}

/**
 * Shared singleton. It is a Proxy rather than a plain `new GitHubClient()`
 * because the constructor reads `env.githubToken`, which THROWS when unset —
 * a module-level construction would blow up any Next.js route that merely
 * imports this file transitively. The proxy defers that to first use.
 *
 * (This is also why the class uses `private` fields rather than `#private`
 * ones: `#private` access through a Proxy throws a TypeError.)
 */
export const github: GitHubClient = new Proxy({} as GitHubClient, {
  get(_target, prop) {
    const client = getGitHubClient();
    const value: unknown = Reflect.get(client, prop, client);
    return typeof value === 'function'
      ? (value as (...args: never[]) => unknown).bind(client)
      : value;
  },
});

/**
 * Public data shapes for the GitHub client.
 *
 * These are hand-written rather than derived from a schema package on purpose:
 * the ingestion pipeline codes against exactly this contract, and pinning it
 * here means a GitHub payload change shows up as one failing mapper instead of
 * a hundred type errors across the pipeline.
 */

/**
 * A full repository object, exactly as it appears INSIDE `/search/repositories`
 * `items[]`. Search items are complete repo objects — they already carry
 * `topics[]` and `license{}` — so discovery never needs a follow-up
 * `/repos/{o}/{r}`, `/topics` or `/license` call. `getRepoByFullName` returns
 * the same shape for that reason.
 */
export interface SearchRepoItem {
  id: number;
  node_id: string;
  full_name: string;
  name: string;
  owner: { login: string; id: number; type: string; avatar_url: string };
  description: string | null;
  homepage: string | null;
  language: string | null;
  topics: string[];
  license: { spdx_id: string | null; name: string | null } | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count: number;
  size: number;
  default_branch: string;
  archived: boolean;
  fork: boolean;
  is_template: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
}

/**
 * Normalized result of the bulk GraphQL sync.
 *
 * Almost everything is nullable because GitHub's own schema is: empty repos
 * return `pushedAt: null` and `defaultBranchRef: null`, unlicensed repos return
 * `licenseInfo: null`, and `spdxId` can be the literal string "NOASSERTION".
 */
export interface GraphRepo {
  nodeId: string;
  githubId: number | null;
  fullName: string;
  ownerLogin: string;
  name: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  topics: string[];
  licenseSpdxId: string | null;
  licenseName: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  watchers: number;
  sizeKb: number;
  defaultBranch: string | null;
  isArchived: boolean;
  isFork: boolean;
  isTemplate: boolean;
  ownerType: string | null;
  ownerAvatarUrl: string | null;
  ownerLocation: string | null;
  createdAt: string | null;
  pushedAt: string | null;
  updatedAt: string | null;
  latestReleaseTag: string | null;
  latestReleaseAt: string | null;
  /**
   * Releases created in the last 365 days, counted from the newest
   * `RELEASES_PAGE` releases. It saturates at that page size, so treat a value
   * equal to the page size as "at least this many", not an exact count.
   */
  releasesLastYear: number | null;
  readme: string | null;
}

/** One rate-limit bucket. `remaining`/`limit` are -1 until a response is seen. */
export interface BucketState {
  remaining: number;
  limit: number;
  resetAt: Date | null;
}

/**
 * The three budgets are entirely independent pools:
 *   core    5,000 requests / rolling hour
 *   search     30 requests / rolling MINUTE
 *   graphql 5,000 points   / rolling hour
 */
export interface RateLimitState {
  core: BucketState;
  search: BucketState;
  graphql: BucketState;
}

export interface SearchResult {
  totalCount: number;
  items: SearchRepoItem[];
  /** GitHub timed out internally and returned partial matches — requeue narrower. */
  incompleteResults: boolean;
  /**
   * True when GitHub answered 422 "Only the first 1000 search results are
   * available". That is a SHARD-HARDER signal, not an error.
   */
  capped: boolean;
}

export type RepoLookupResult =
  | { status: 'ok'; repo: SearchRepoItem; etag: string | null }
  | { status: 'not-modified' }
  | { status: 'gone' };

export interface ContributorCountResult {
  count: number | null;
  /**
   * The count is a lower bound: either the repo 403'd with "too large to list
   * contributors", or the Link-header count hit the ~300+ saturation zone where
   * GitHub's 500-author-email ceiling starts biting.
   */
  truncated: boolean;
}

export interface TopContributor {
  login: string;
  id: number;
  avatarUrl: string | null;
  contributions: number;
}

export interface GitHubUserProfile {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  followers: number;
  publicRepos: number;
}

export interface GitHubClientOptions {
  token?: string;
  concurrency?: number;
  userAgent?: string;
}

export interface SearchOptions {
  page?: number;
  perPage?: number;
  sort?: string;
  order?: string;
}

/**
 * Additive extension to the bulk-sync methods: the pipeline's cheap daily
 * sentinel pass does not want README blobs (they are unbounded and are the #1
 * cause of GitHub's 10s GraphQL timeout).
 */
export interface BulkFetchOptions {
  includeReadme?: boolean;
}

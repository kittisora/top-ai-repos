/**
 * GitHub API client — native fetch, no @octokit.
 *
 * @octokit/graphql surfaces GraphQL `errors[]` as a thrown GraphqlResponseError,
 * which throws away the USABLE partial data that ships alongside per-alias
 * NOT_FOUND errors and alongside RESOURCE_LIMITS_EXCEEDED. For a bulk sync that
 * partial data is most of the value, so the transport is hand-rolled.
 *
 * Everything the ingestion pipeline needs is re-exported from here.
 */

export { GitHubClient, getGitHubClient, github } from './client';
export { GitHubError, GitHubTooHeavyError } from './errors';
export { RELEASES_PAGE } from './queries';
export type { RateResource } from './ratelimit';
export type {
  BucketState,
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

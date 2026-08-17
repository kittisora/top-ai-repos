/**
 * GraphQL documents and the raw response shapes they produce.
 *
 * Every field name and nullability below was checked against the live SDL
 * (docs.github.com/public/fpt/schema.docs.graphql). Several commonly-remembered
 * names are wrong and are called out inline — `stargazerCount` not `stars`,
 * `diskUsage` not `size`, `homepageUrl` not `homepage`, `nameWithOwner` not
 * `fullName`, `licenseInfo` not `license`.
 */

/** repositoryTopics takes NO orderBy argument. */
const TOPICS_PAGE = 20;

/**
 * `releasesLastYear` is derived from this page, so the value saturates here.
 * Bigger pages are cheap in points but feed the Sept-2025 resource limiter,
 * which is the binding constraint on batch size.
 */
export const RELEASES_PAGE = 30;

/**
 * Git paths are CASE-SENSITIVE, so `HEAD:README.md` alone returns null for
 * `readme.md`, `Readme.md`, `README.rst`, `docs/README.md` and
 * `.github/README.md` — roughly 15-25% false "no README". `object()` is not a
 * connection, so probing several costs zero extra points; it does cost
 * execution work, which is why README batches run at half the alias count.
 */
export const README_ALIASES = [
  'readmeMd',
  'readmeLower',
  'readmeTitle',
  'readmeRst',
  'readmeBare',
  'readmeDocs',
  'readmeDot',
] as const;

export type ReadmeAlias = (typeof README_ALIASES)[number];

const REPO_META_FRAGMENT = `
fragment RepoMeta on Repository {
  id
  databaseId
  nameWithOwner
  name
  description
  homepageUrl
  createdAt
  updatedAt
  pushedAt
  isArchived
  isFork
  isTemplate
  isEmpty
  isDisabled
  diskUsage
  stargazerCount
  forkCount
  openIssues: issues(states: OPEN, first: 1) { totalCount }
  watchers(first: 1) { totalCount }
  primaryLanguage { name }
  licenseInfo { spdxId name }
  repositoryTopics(first: ${TOPICS_PAGE}) { nodes { topic { name } } }
  latestRelease { tagName publishedAt createdAt }
  releases(first: ${RELEASES_PAGE}, orderBy: { field: CREATED_AT, direction: DESC }) {
    nodes { createdAt publishedAt isDraft }
  }
  defaultBranchRef { name }
  owner {
    __typename
    login
    avatarUrl
    ... on User { location }
    ... on Organization { location }
  }
}`;

/**
 * The metrics-only shape: four volatile counters, plus the two ids needed to
 * re-key the response onto our rows. Nothing else.
 *
 * This exists because RepoMeta is far too heavy for a sweep that writes four
 * integers. RepoMeta drags `releases(first: 30)` and
 * `repositoryTopics(first: 20)` behind every repo, so a 50-wide query resolves
 * ~2,600 sub-nodes and lands squarely on the 9s client timeout: measured over
 * 16 trials on this host, only 3 came back under the limit (TTFB 8.48-8.67s),
 * 9 aborted and 4 drew a server 502/503. Every one of those failures halves the
 * batch and retries, so the sweep silently ran at 25-wide and paid for release
 * and topic data it discarded.
 *
 * The same 50 ids through this fragment answer in 2.09-2.31s at a cost of 1
 * point (measured 2026-08-17), which is a quarter of the timeout budget rather
 * than the whole of it.
 *
 * `databaseId` is NOT decoration. GitHub rewrites `id` to the modern global
 * form on every response (see the X-Github-Next-Global-ID header in client.ts),
 * so the node id that comes back is frequently not the one that was sent — the
 * numeric id is the only stable join key. Dropping it here would silently break
 * every caller's re-key.
 */
const REPO_METRICS_FRAGMENT = `
fragment RepoMetrics on Repository {
  id
  databaseId
  stargazerCount
  forkCount
  openIssues: issues(states: OPEN, first: 1) { totalCount }
  watchers(first: 1) { totalCount }
}`;

const BLOB_FRAGMENT = `
fragment BlobText on GitObject {
  ... on Blob { text isBinary isTruncated byteSize }
}`;

const README_FRAGMENT = `
fragment RepoReadme on Repository {
  readmeMd:    object(expression: "HEAD:README.md")         { ...BlobText }
  readmeLower: object(expression: "HEAD:readme.md")         { ...BlobText }
  readmeTitle: object(expression: "HEAD:Readme.md")         { ...BlobText }
  readmeRst:   object(expression: "HEAD:README.rst")        { ...BlobText }
  readmeBare:  object(expression: "HEAD:README")            { ...BlobText }
  readmeDocs:  object(expression: "HEAD:docs/README.md")    { ...BlobText }
  readmeDot:   object(expression: "HEAD:.github/README.md") { ...BlobText }
}`;

/** An unused fragment definition is a validation error, so assemble per shape. */
function fragments(includeReadme: boolean): string {
  return includeReadme
    ? `${REPO_META_FRAGMENT}\n${README_FRAGMENT}\n${BLOB_FRAGMENT}`
    : REPO_META_FRAGMENT;
}

function spread(includeReadme: boolean): string {
  return includeReadme ? '...RepoMeta ...RepoReadme' : '...RepoMeta';
}

/**
 * Aliased batch over `repository(owner:, name:)`.
 *
 * Aliases MUST NOT start with a digit (`0: repository(...)` is a syntax error),
 * hence r0..rN. owner/name go through declared variables rather than string
 * interpolation so a repo named `"){...}` cannot rewrite the document.
 *
 * `followRenames` defaults to true, so a stale owner/name silently resolves
 * through a rename — which is what we want for a sync, and why the pipeline
 * must key on the numeric id and re-read `nameWithOwner` from the response.
 */
export function buildAliasedRepoQuery(count: number, includeReadme: boolean): string {
  const vars: string[] = [];
  const selections: string[] = [];
  for (let i = 0; i < count; i++) {
    vars.push(`$o${i}: String!, $n${i}: String!`);
    selections.push(`  r${i}: repository(owner: $o${i}, name: $n${i}) { ${spread(includeReadme)} }`);
  }
  return `query BulkRepoMeta(${vars.join(', ')}) {
${selections.join('\n')}
  rateLimit { cost limit remaining used resetAt }
}
${fragments(includeReadme)}`;
}

/**
 * `nodes(ids:)` returns `[Node]!` — a plain LIST, not a Connection, so
 * `first`/`last` is neither required nor accepted. Elements are NULLABLE and
 * come back in input order, so a deleted repo yields null at its index while
 * the rest of the batch succeeds.
 */
export function buildNodesQuery(includeReadme: boolean): string {
  return `query ReposByNodeIds($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on Repository { ${spread(includeReadme)} }
  }
  rateLimit { cost limit remaining used resetAt }
}
${fragments(includeReadme)}`;
}

/**
 * The counters-only twin of buildNodesQuery, for the metrics sweep.
 *
 * A separate builder rather than a third mode on buildNodesQuery: that one's
 * `includeReadme` boolean already selects between two fragment sets, and a
 * second orthogonal flag would make the four combinations mean things nobody
 * intends (metrics + readme being nonsense).
 *
 * `nodes(ids:)` is capped by GitHub at 100 ids per call — 101 is rejected
 * outright with ARGUMENT_LIMIT, not truncated — so callers must batch below
 * that regardless of how cheap the selection set is.
 */
export function buildNodesMetricsQuery(): string {
  return `query RepoMetricsByNodeIds($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on Repository { ...RepoMetrics }
  }
  rateLimit { cost limit remaining used resetAt }
}
${REPO_METRICS_FRAGMENT}`;
}

/* ------------------------------------------------------------------ *
 * Raw response shapes
 * ------------------------------------------------------------------ */

export interface GqlRateLimit {
  cost: number;
  limit: number;
  remaining: number;
  used: number;
  /** ISO-8601 despite the SDL docstring claiming "UTC epoch seconds". */
  resetAt: string;
}

export interface GqlBlob {
  text: string | null;
  /** Nullable in the SDL: null when the encoding cannot be determined. */
  isBinary: boolean | null;
  isTruncated: boolean;
  byteSize: number;
}

type GqlReadmeFields = { [K in ReadmeAlias]?: GqlBlob | null };

export interface GqlRepo extends GqlReadmeFields {
  __typename?: string;
  id: string;
  databaseId: number | null;
  nameWithOwner: string;
  name: string;
  description: string | null;
  homepageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  pushedAt: string | null;
  isArchived: boolean;
  isFork: boolean;
  isTemplate: boolean;
  isEmpty: boolean;
  isDisabled: boolean;
  diskUsage: number | null;
  stargazerCount: number;
  forkCount: number;
  openIssues: { totalCount: number } | null;
  watchers: { totalCount: number } | null;
  primaryLanguage: { name: string } | null;
  licenseInfo: { spdxId: string | null; name: string } | null;
  repositoryTopics: { nodes: ({ topic: { name: string } | null } | null)[] | null } | null;
  latestRelease: { tagName: string; publishedAt: string | null; createdAt: string } | null;
  releases: {
    nodes: ({ createdAt: string; publishedAt: string | null; isDraft: boolean } | null)[] | null;
  } | null;
  defaultBranchRef: { name: string } | null;
  owner: {
    __typename: string;
    login: string;
    avatarUrl: string | null;
    /** Present on both User and Organization; absent on any other owner type. */
    location?: string | null;
  } | null;
}

export interface GqlAliasedRepoResponse {
  rateLimit?: GqlRateLimit | null;
  /** r0..rN, each nullable when that single alias failed. */
  [alias: string]: GqlRepo | GqlRateLimit | null | undefined;
}

export interface GqlNodesResponse {
  nodes: (GqlRepo | null)[] | null;
  rateLimit?: GqlRateLimit | null;
}

/** The RepoMetrics fragment's raw shape — a strict subset of GqlRepo. */
export interface GqlRepoMetrics {
  __typename?: string;
  id: string;
  databaseId: number | null;
  stargazerCount: number;
  forkCount: number;
  openIssues: { totalCount: number } | null;
  watchers: { totalCount: number } | null;
}

export interface GqlMetricsNodesResponse {
  nodes: (GqlRepoMetrics | null)[] | null;
  rateLimit?: GqlRateLimit | null;
}

export interface GqlError {
  type?: string;
  message?: string;
  path?: (string | number)[];
}

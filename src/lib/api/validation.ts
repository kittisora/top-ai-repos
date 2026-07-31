/**
 * Request validation for the JSON API.
 *
 * Every query parameter is parsed by zod before it reaches a query function.
 * The rule is reject, don't coerce: `?minStars=abc` is a 400 with a message,
 * not a silent 0, because silently ignoring a filter shows the user results
 * they did not ask for and they have no way to tell.
 */

import { z } from 'zod';

import { CATEGORY_BY_SLUG, GROUP_BY_SLUG } from '@/lib/taxonomy';

// ---------------------------------------------------------------------------
// Primitive query-param schemas
// ---------------------------------------------------------------------------

/**
 * Query params arrive as strings, so numbers are validated as digit strings
 * before conversion. `z.coerce.number()` would turn "" into 0 and "1e9" into a
 * billion — both are silent coercions of input the caller got wrong.
 */
function intParam(min: number, max: number) {
  return z
    .string()
    .regex(/^\d+$/, 'must be a whole number')
    .transform((value) => Number.parseInt(value, 10))
    .refine((n) => n >= min && n <= max, `must be between ${min} and ${max}`);
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

const boolParam = z
  .string()
  .refine(
    (value) => TRUE_VALUES.has(value.toLowerCase()) || FALSE_VALUES.has(value.toLowerCase()),
    'must be true or false',
  )
  .transform((value) => TRUE_VALUES.has(value.toLowerCase()));

/** Accepts a bare date (2026-01-31) or a full ISO timestamp. */
const isoDateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}([T ].*)?$/, 'must be an ISO date such as 2026-01-31')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'is not a real date');

export const REPO_SORTS = [
  'trending',
  'stars',
  'stars-today',
  'stars-week',
  'stars-month',
  'velocity',
  'quality',
  'newest',
  'recently-updated',
  'relevance',
] as const;

export const LICENSE_CLASSES = [
  'permissive',
  'weak-copyleft',
  'strong-copyleft',
  'non-commercial',
  'other',
  'none',
] as const;

const categorySlug = z
  .string()
  .refine(
    (slug) => CATEGORY_BY_SLUG.has(slug),
    'is not a known category slug — see GET /api/categories',
  );

const groupSlug = z
  .string()
  .refine(
    (slug) => GROUP_BY_SLUG.has(slug),
    'is not a known group slug — see GET /api/categories',
  );

// ---------------------------------------------------------------------------
// GET /api/repositories
// ---------------------------------------------------------------------------

export const repoListQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    category: categorySlug.optional(),
    group: groupSlug.optional(),
    language: z.string().trim().min(1).max(64).optional(),
    license: z.enum(LICENSE_CLASSES).optional(),
    country: z.string().trim().min(1).max(64).optional(),
    minStars: intParam(0, 100_000_000).optional(),
    maxStars: intParam(0, 100_000_000).optional(),
    minQuality: intParam(0, 100).optional(),
    createdAfter: isoDateParam.optional(),
    pushedAfter: isoDateParam.optional(),
    includeArchived: boolParam.optional(),
    sort: z.enum(REPO_SORTS).optional(),
    // Capped rather than clamped: a caller asking for page 100000 has a bug,
    // and the OFFSET it implies is a table scan.
    page: intParam(1, 10_000).optional(),
    perPage: intParam(1, 100).optional(),
  })
  .refine(
    (value) =>
      value.minStars === undefined ||
      value.maxStars === undefined ||
      value.minStars <= value.maxStars,
    { message: 'minStars must not exceed maxStars', path: ['minStars'] },
  );

export type RepoListQuery = z.infer<typeof repoListQuerySchema>;

export const contributorsQuerySchema = z.object({
  country: z.string().trim().min(1).max(64).optional(),
  category: categorySlug.optional(),
  group: groupSlug.optional(),
  page: intParam(1, 10_000).optional(),
  perPage: intParam(1, 100).optional(),
});

/**
 * URLSearchParams -> plain object, dropping empty values.
 *
 * `?language=` (the shape a cleared <select> submits) must mean "no filter",
 * not "language equal to the empty string", and an empty string would fail
 * every min(1) check below and 400 a perfectly ordinary form submission.
 * Repeated keys keep the first value; none of these filters are multi-valued.
 */
export function searchParamsToObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of params) {
    if (value === '' || key in out) continue;
    out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// POST /api/submissions
// ---------------------------------------------------------------------------

export const submissionSchema = z.object({
  url: z.string().trim().min(1, 'is required').max(300),
  note: z.string().trim().max(2000).optional(),
});

export interface NormalizedRepo {
  owner: string;
  name: string;
  /** "owner/name" — the key used everywhere else in the schema. */
  fullName: string;
  /** Canonical https URL, which is what gets stored and deduplicated on. */
  url: string;
}

export type NormalizeResult =
  | { ok: true; value: NormalizedRepo }
  | { ok: false; error: string };

/**
 * GitHub's own rules: owners are 1-39 chars of alphanumerics and single
 * internal hyphens; repository names allow dots and underscores too. Enforcing
 * them here means an obviously-bogus submission is rejected before it reaches
 * the database, and the review queue stays about real repos.
 */
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

const EXAMPLE = 'https://github.com/owner/name';

function fail(error: string): NormalizeResult {
  return { ok: false, error };
}

/**
 * Normalise anything that plausibly identifies a GitHub repository down to
 * "owner/name".
 *
 * Accepts: full http(s) URLs (with or without www, trailing slash, .git,
 * query string or fragment), scp-style SSH remotes, bare "github.com/o/n",
 * and a plain "owner/name". Everything else — other hosts, deep paths like
 * /tree/main/src, gists — is rejected with a message that says what was
 * expected, because a silently-wrong normalisation would enqueue the wrong
 * repository for indexing.
 */
export function normalizeGitHubRepo(raw: string): NormalizeResult {
  const input = raw.trim();
  if (input === '') return fail(`A repository URL is required, for example ${EXAMPLE}`);
  if (input.length > 300) return fail('That value is too long to be a GitHub repository URL.');

  let path = input;

  const ssh = /^(?:git\+)?(?:ssh:\/\/)?git@github\.com[:/](.+)$/i.exec(path);
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(path);
  const hasHost = /^(?:www\.)?github\.com\//i.test(path);

  if (ssh) {
    path = ssh[1];
  } else if (hasScheme || hasHost) {
    let url: URL;
    try {
      url = new URL(hasScheme ? path : `https://${path}`);
    } catch {
      return fail(`That does not look like a URL. Expected something like ${EXAMPLE}`);
    }

    const protocol = url.protocol.replace(':', '').toLowerCase();
    if (protocol !== 'http' && protocol !== 'https' && protocol !== 'git') {
      return fail(`Only http(s) GitHub URLs are supported, got "${protocol}://".`);
    }

    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'github.com') {
      return fail(`Only github.com repositories can be submitted, got "${url.hostname}".`);
    }

    // Anything in the query string or fragment is UI state, never part of the
    // repository identity — URL parsing has already stripped both.
    path = url.pathname;
  } else if (/[:\\]/.test(path) || path.startsWith('//')) {
    return fail(`That does not look like a GitHub repository. Expected ${EXAMPLE}`);
  }

  const segments = path.split('/').filter((segment) => segment !== '');
  if (segments.length !== 2) {
    return fail(
      segments.length > 2
        ? `Link to the repository itself, not a page inside it. Expected ${EXAMPLE}`
        : `Expected an "owner/name" repository reference, for example ${EXAMPLE}`,
    );
  }

  const owner = segments[0];
  const name = segments[1].replace(/\.git$/i, '');

  if (!OWNER_RE.test(owner)) {
    return fail(`"${owner}" is not a valid GitHub owner name.`);
  }
  if (name === '' || name === '.' || name === '..' || !NAME_RE.test(name)) {
    return fail(`"${segments[1]}" is not a valid GitHub repository name.`);
  }

  return {
    ok: true,
    value: {
      owner,
      name,
      fullName: `${owner}/${name}`,
      url: `https://github.com/${owner}/${name}`,
    },
  };
}

/**
 * Typed environment access.
 *
 * Does NOT load .env itself. Next.js loads .env automatically, and the CLI
 * workers import 'dotenv/config' as their first statement — putting a dotenv
 * import in here would drag it into the client-side module graph.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        'Copy .env.example to .env and fill it in.',
    );
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export const env = {
  get databaseUrl() {
    return required('DATABASE_URL');
  },
  get githubToken() {
    return required('GITHUB_TOKEN');
  },
  get openaiApiKey(): string | undefined {
    return process.env.OPENAI_API_KEY || undefined;
  },
  get openaiModel() {
    return process.env.OPENAI_MODEL || 'gpt-5-mini';
  },
  get minStars() {
    return int('MIN_STARS', 50);
  },
  get discoveryLimit() {
    return int('DISCOVERY_LIMIT', 2000);
  },
  get githubConcurrency() {
    // The documented secondary limit is 100 concurrent requests, but the
    // unobservable CPU-time limit binds long before that. 6-8 is the practical
    // ceiling for sustained ingestion.
    return Math.min(16, Math.max(1, int('GITHUB_CONCURRENCY', 6)));
  },
  get enableLlmClassify() {
    return bool('ENABLE_LLM_CLASSIFY', false) && Boolean(process.env.OPENAI_API_KEY);
  },
  /**
   * How long the read layer reuses its whole-table aggregates (see
   * @/lib/queries/cache). Every page is force-dynamic, so without this each view
   * re-scans the corpus for the stat tiles and filter dropdowns — which on a
   * free-tier database is the difference between comfortable and over quota.
   * Raise it if egress is tight; set 0 to disable caching while debugging.
   */
  get queryCacheTtlSeconds() {
    return Math.max(0, int('QUERY_CACHE_TTL_SECONDS', 600));
  },
  get siteName() {
    return process.env.NEXT_PUBLIC_SITE_NAME || 'Top AI Repos';
  },
  /**
   * Absolute site origin, no trailing slash. Drives metadataBase, canonical
   * URLs, the sitemap and robots.txt — so for SEO to work in production this
   * MUST be set to the real domain (e.g. https://ailist.dev), not localhost.
   */
  get siteUrl() {
    const raw = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    return raw.replace(/\/+$/, '');
  },
} as const;

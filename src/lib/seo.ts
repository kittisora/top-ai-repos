import { env } from './env';

/**
 * SEO data helpers — pure objects, no JSX, so they can be imported by any
 * server component and serialised into a <script type="application/ld+json">.
 *
 * Keyword strategy: the site's edge over "another AI list" is that it ranks by
 * momentum and scores adoption risk, so the keywords target both the broad
 * discovery intent ("open source AI tools") and the specific sub-ecosystems we
 * categorise ("RAG", "vector databases", "AI agents"), plus comparison intent
 * ("compare AI tools", "alternatives") which is where a directory actually wins
 * search traffic.
 */
export const SITE_KEYWORDS = [
  'open source AI',
  'AI repositories',
  'open source AI tools',
  'AI GitHub repositories',
  'trending AI projects',
  'AI project discovery',
  'AI repository directory',
  'LLM frameworks',
  'AI agents',
  'RAG',
  'retrieval augmented generation',
  'vector databases',
  'machine learning libraries',
  'AI inference',
  'model fine-tuning',
  'AI coding tools',
  'MCP servers',
  'compare AI tools',
  'best open source AI',
  'AI tool alternatives',
];

const SITE_DESCRIPTION =
  'Discover, compare and track open-source AI repositories on GitHub. Browse by category, ' +
  'language and licence; rank by star momentum, not just totals; and read a quality score ' +
  'that weighs maintenance, release cadence, contributor bus-factor and licence safety.';

export { SITE_DESCRIPTION };

/**
 * Site-level graph: a WebSite node carrying the sitelinks SearchAction (so
 * Google can offer a search box straight into /repos), plus the Organization
 * that publishes it.
 */
export function websiteJsonLd() {
  const base = env.siteUrl;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${base}/#website`,
        url: `${base}/`,
        name: env.siteName,
        description: SITE_DESCRIPTION,
        publisher: { '@id': `${base}/#organization` },
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${base}/repos?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'Organization',
        '@id': `${base}/#organization`,
        name: env.siteName,
        url: `${base}/`,
        logo: `${base}/android-chrome-512x512.png`,
      },
    ],
  };
}

export interface RepoJsonLdInput {
  fullName: string;
  ownerLogin: string;
  name: string;
  description: string | null;
  language: string | null;
  stars: number;
  licenseName: string | null;
  githubCreatedAt: Date | null;
  githubUpdatedAt: Date | null;
  primaryCategoryName?: string | null;
}

/**
 * Per-repo structured data. SoftwareSourceCode is the closest schema.org type
 * for a code repository; the InteractionCounter carries the star count, which
 * is what makes the entry legible to Google as a real, popular project rather
 * than a thin directory stub.
 */
export function repositoryJsonLd(repo: RepoJsonLdInput) {
  const url = `${env.siteUrl}/repos/${encodeURIComponent(repo.ownerLogin)}/${encodeURIComponent(repo.name)}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: repo.fullName,
    description: repo.description ?? undefined,
    codeRepository: `https://github.com/${repo.fullName}`,
    url,
    programmingLanguage: repo.language ?? undefined,
    author: { '@type': 'Organization', name: repo.ownerLogin },
    license: repo.licenseName ?? undefined,
    applicationCategory: repo.primaryCategoryName ?? undefined,
    dateCreated: repo.githubCreatedAt?.toISOString(),
    dateModified: repo.githubUpdatedAt?.toISOString(),
    interactionStatistic: {
      '@type': 'InteractionCounter',
      interactionType: 'https://schema.org/LikeAction',
      userInteractionCount: repo.stars,
    },
    isPartOf: { '@id': `${env.siteUrl}/#website` },
  };
}

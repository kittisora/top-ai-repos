import { Archive, CircleDot, ExternalLink, Eye, GitFork, Globe, Star, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CategoryPill, LicenseBadge, QualityBadge } from '@/components/badges';
import { loadRepository } from '@/components/data';
import { QualityBreakdown } from '@/components/quality-breakdown';
import { ReadmeSection } from '@/components/readme-section';
import { SetupNotice } from '@/components/setup-notice';
import { StarHistoryChart } from '@/components/star-history-chart';
import { LinkButton, Panel } from '@/components/ui';
import { env } from '@/lib/env';
import { getRenderedReadme } from '@/lib/github/readme';
import type { RepositoryDetail } from '@/lib/queries';
import { repositoryJsonLd } from '@/lib/seo';
import { cn, formatCompact, formatDelta, formatNumber, formatRelativeTime } from '@/lib/utils';

/**
 * ISR rather than force-dynamic — the one page in the app that is cached.
 *
 * There are ~29,000 of these and every one is in the sitemap, so they are the
 * bulk of the crawlable surface. Each render is expensive: the repo row carries a
 * 4,000-character README excerpt, plus 90 days of metric rows, plus 20
 * contributors, plus a live GitHub fetch for the rendered README. Served
 * force-dynamic, a crawler walking the sitemap paid all of that per URL per
 * visit, which is where most of this project's database egress went.
 *
 * An hour is safe because nothing here changes faster than that: the pipeline
 * runs once a day, so a cached page is at worst showing numbers from earlier in
 * the same day. Unlike the homepage and the explorer this route can be cached at
 * all because it has a dynamic segment and no `generateStaticParams` — Next
 * renders it on first request rather than at build time, so the build never needs
 * a database.
 *
 * ONE CAVEAT: `query()` turns a database failure into a rendered notice rather
 * than a throw, and a successful render is what gets cached — so a blip during a
 * cache miss can pin that notice on one repo URL until the window expires. It
 * self-heals on the next revalidation; the tradeoff is worth it at 29,000 pages.
 */
export const revalidate = 3600;

/**
 * Returning an EMPTY array is load-bearing — do not delete this as dead code.
 *
 * `revalidate` on its own does nothing here. Without a `generateStaticParams`
 * export Next has no fallback entry for the route, leaves `dynamicRoutes` in
 * .next/prerender-manifest.json empty, and server-renders every request from
 * scratch — which is what this file did before, and the caching above would have
 * been silently inert. Exporting it with `[]` is the documented way to say
 * "prerender nothing at build time, but cache each path once it is first
 * requested": there are 29,000 of these and the build has no database, so
 * enumerating them at build time is neither possible nor wanted.
 *
 * Verify with `npm run build` — the route must appear under `dynamicRoutes` with
 * `fallbackRevalidate: 3600`, not merely as `ƒ` in the route summary.
 */
export function generateStaticParams(): { owner: string; name: string }[] {
  return [];
}

interface DetailPageProps {
  params: Promise<{ owner: string; name: string }>;
}

export async function generateMetadata({ params }: DetailPageProps): Promise<Metadata> {
  const { owner, name } = await params;
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  const found = await loadRepository(fullName);
  const repo = found.data;

  if (!repo) return { title: fullName };

  const category = repo.primaryCategory?.name;
  const canonical = `/repos/${repo.ownerLogin}/${repo.name}`;

  const parts = [
    `${repo.fullName}: open-source`,
    category ? category.toLowerCase() : 'AI',
    repo.language ? `project in ${repo.language}` : 'project',
    `with ${formatCompact(repo.stars)} GitHub stars.`,
  ];
  const summary = repo.description ? `${repo.description} ` : '';
  const description =
    `${summary}${parts.join(' ')} See its trend and quality score on ${env.siteName}.`.slice(
      0,
      300,
    );

  const keywords = [
    repo.fullName,
    repo.name,
    ...repo.topics.slice(0, 12),
    category,
    repo.language,
    'open source',
    'GitHub',
  ].filter((value): value is string => Boolean(value));

  return {
    title: `${repo.fullName}${category ? ` \u2014 ${category}` : ''}`,
    description,
    keywords,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      url: canonical,
      title: repo.fullName,
      description,
    },
    twitter: { card: 'summary_large_image', title: repo.fullName, description },
  };
}

export default async function RepositoryPage({ params }: DetailPageProps) {
  const { owner, name } = await params;
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  const found = await loadRepository(fullName);

  if (found.error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <SetupNotice error={found.error} />
      </div>
    );
  }

  if (!found.data) notFound();

  const repo = found.data;
  const renderedReadme = repo.readmeExcerpt ? await getRenderedReadme(repo.fullName) : null;

  return (
    <div className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            repositoryJsonLd({
              fullName: repo.fullName,
              ownerLogin: repo.ownerLogin,
              name: repo.name,
              description: repo.description,
              language: repo.language,
              stars: repo.stars,
              licenseName: repo.licenseName,
              githubCreatedAt: repo.githubCreatedAt,
              githubUpdatedAt: repo.githubUpdatedAt,
              primaryCategoryName: repo.primaryCategory?.name ?? null,
            }),
          ),
        }}
      />

      <RepoHeader repo={repo} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <MetricRow repo={repo} />

          <section aria-labelledby="trend-heading">
            <h2 id="trend-heading" className="sr-only">
              Trend
            </h2>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <StarHistoryChart points={repo.metrics} />

              <Panel className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 sm:w-56 sm:grid-cols-1">
                <TrendRow label="Today" value={repo.starsDay} window="today" />
                <TrendRow label="This week" value={repo.starsWeek} window="this week" />
                <TrendRow label="This month" value={repo.starsMonth} window="this month" />

                <div>
                  <p className="text-[0.6875rem] uppercase tracking-wider text-quaternary">
                    Momentum
                  </p>
                  <p className="num text-sm font-semibold">{repo.trendScore.toFixed(1)}</p>
                  <p className="num text-xs text-quaternary">
                    growth rate {(repo.trendVelocity * 100).toFixed(2)}%/day
                  </p>
                </div>
              </Panel>
            </div>
          </section>

          {repo.readmeExcerpt ? (
            <ReadmeSection
              fullName={repo.fullName}
              excerpt={repo.readmeExcerpt}
              readmeLength={repo.readmeLength}
              renderedHtml={renderedReadme}
            />
          ) : null}

          <Contributors repo={repo} />
        </div>

        <div className="space-y-6">
          <QualityBreakdown repo={repo} />
          <Categories repo={repo} />
          <DetailsPanel repo={repo} />
        </div>
      </div>
    </div>
  );
}

function RepoHeader({ repo }: { repo: RepositoryDetail }) {
  return (
    <header>
      <nav aria-label="Breadcrumb" className="mb-3 text-xs text-quaternary">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/repos" className="hover:text-primary">
              Repositories
            </Link>
          </li>

          {repo.primaryCategory ? (
            <>
              <li aria-hidden="true">/</li>
              <li>
                <Link
                  href={`/categories/${repo.primaryCategory.slug}`}
                  className="hover:text-primary"
                >
                  {repo.primaryCategory.name}
                </Link>
              </li>
            </>
          ) : null}

          <li aria-hidden="true">/</li>
          <li className="text-tertiary">{repo.fullName}</li>
        </ol>
      </nav>

      <div className="flex flex-wrap items-start gap-4">
        {repo.ownerAvatarUrl ? (
          <Image
            src={repo.ownerAvatarUrl}
            alt=""
            width={48}
            height={48}
            className="size-12 rounded-lg border border-secondary bg-secondary"
            unoptimized
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            <a
              href={`https://github.com/${repo.fullName}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-brand-secondary"
            >
              <span className="text-tertiary">{repo.ownerLogin}/</span>
              <span className="break-all">{repo.name}</span>
            </a>
          </h1>

          {repo.description ? (
            <p className="mt-1.5 max-w-3xl text-sm text-tertiary">{repo.description}</p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <QualityBadge grade={repo.qualityGrade} score={repo.qualityScore} size="md" />
            <LicenseBadge licenseClass={repo.licenseClass} spdxId={repo.licenseSpdxId} />

            {repo.language ? (
              <Link
                href={`/repos?language=${encodeURIComponent(repo.language)}`}
                className="rounded border border-secondary px-1.5 py-0.5 text-xs text-tertiary hover:text-primary"
              >
                {repo.language}
              </Link>
            ) : null}

            {repo.isArchived ? (
              <span className="inline-flex items-center gap-1 rounded border border-grade-f/40 px-1.5 py-0.5 text-xs text-grade-f">
                <Archive className="size-3" aria-hidden="true" />
                Archived {'\u2014'} read only
              </span>
            ) : null}

            {repo.isFork ? (
              <span className="rounded border border-secondary px-1.5 py-0.5 text-xs text-quaternary">
                Fork
              </span>
            ) : null}

            {repo.isTemplate ? (
              <span className="rounded border border-secondary px-1.5 py-0.5 text-xs text-quaternary">
                Template
              </span>
            ) : null}
          </div>

          {repo.topics.length > 0 ? (
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {repo.topics.map((topic) => (
                <li key={topic}>
                  <Link
                    href={`/repos?q=${encodeURIComponent(topic)}`}
                    className="inline-block rounded-full border border-secondary bg-secondary px-2 py-0.5 font-mono text-[0.6875rem] text-tertiary hover:text-primary"
                  >
                    {topic}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <LinkButton
            href={`https://github.com/${repo.fullName}`}
            variant="primary"
            iconLeading={<ExternalLink className="size-4" aria-hidden="true" />}
          >
            View on GitHub
          </LinkButton>

          {repo.homepage ? (
            <LinkButton href={repo.homepage} iconLeading={<Globe className="size-4" aria-hidden="true" />}>
              Website
            </LinkButton>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function MetricRow({ repo }: { repo: RepositoryDetail }) {
  const metrics: { label: string; value: number | null; Icon: typeof Star }[] = [
    { label: 'Stars', value: repo.stars, Icon: Star },
    { label: 'Forks', value: repo.forks, Icon: GitFork },
    { label: 'Watchers', value: repo.watchers, Icon: Eye },
    { label: 'Open issues', value: repo.openIssues, Icon: CircleDot },
    { label: 'Contributors', value: repo.contributorsCount, Icon: Users },
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {metrics.map(({ label, value, Icon }) => (
        <div key={label} className="rounded-lg border border-secondary bg-primary px-3.5 py-3">
          <dt className="flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-wider text-quaternary">
            <Icon className="size-3" aria-hidden="true" />
            {label}
          </dt>
          <dd className="num mt-1 text-xl font-semibold tracking-tight">{formatNumber(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function TrendRow({
  label,
  value,
  window: trendWindow,
}: {
  label: string;
  value: number;
  window: 'today' | 'this week' | 'this month';
}) {
  return (
    <div>
      <p className="text-[0.6875rem] uppercase tracking-wider text-quaternary">{label}</p>
      <p className="num text-sm font-semibold">
        <span className={value > 0 ? 'text-success-primary' : 'text-tertiary'}>{formatDelta(value)}</span>
        <span className="sr-only"> stars {trendWindow}</span>
      </p>
    </div>
  );
}

function Categories({ repo }: { repo: RepositoryDetail }) {
  if (repo.categories.length === 0) {
    return (
      <Panel className="p-4">
        <h2 className="text-sm font-semibold">Categories</h2>
        <p className="mt-1.5 text-xs text-tertiary">
          Not classified yet. Classification runs as part of <code>npm run ingest</code>.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="p-4">
      <h2 className="text-sm font-semibold">Categories</h2>
      <ul className="mt-2.5 space-y-2.5">
        {repo.categories.map((category) => (
          <li key={category.slug}>
            <div className="flex flex-wrap items-center gap-2">
              <CategoryPill
                name={category.name}
                href={`/categories/${category.slug}`}
                primary={category.isPrimary}
              />

              {category.isPrimary ? (
                <span className="text-[0.6875rem] uppercase tracking-wider text-quaternary">
                  primary
                </span>
              ) : null}

              <span
                className="num ml-auto text-xs text-quaternary"
                title={`Classifier confidence, source: ${category.source}`}
              >
                {Math.round(category.confidence * 100)}%
              </span>
            </div>

            {category.evidence.length > 0 ? (
              <p className="mt-1 text-xs text-quaternary">
                matched {category.evidence.slice(0, 4).join(', ')}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Contributors({ repo }: { repo: RepositoryDetail }) {
  if (repo.contributors.length === 0) {
    return (
      <section aria-labelledby="contributors-heading">
        <h2 id="contributors-heading" className="mb-2 text-sm font-semibold">
          Top contributors
        </h2>
        <Panel className="px-4 py-6 text-center text-sm text-tertiary">
          No contributor data yet {'\u2014'} it is fetched during the contributor sync pass.
        </Panel>
      </section>
    );
  }

  const total = repo.contributors.reduce((sum, person) => sum + person.contributions, 0);

  return (
    <section aria-labelledby="contributors-heading">
      <h2 id="contributors-heading" className="mb-2 text-sm font-semibold">
        Top contributors
        <span className="num ml-2 text-xs font-normal text-quaternary">
          {repo.contributors.length} shown
        </span>
      </h2>

      <Panel className="overflow-hidden">
        <ul>
          {repo.contributors.map((person) => {
            const share = total > 0 ? person.contributions / total : 0;

            return (
              <li
                key={person.id}
                className="flex items-center gap-3 border-b border-secondary px-4 py-2.5 last:border-0"
              >
                {person.avatarUrl ? (
                  <Image
                    src={person.avatarUrl}
                    alt=""
                    width={24}
                    height={24}
                    className="size-6 shrink-0 rounded-full border border-secondary bg-secondary"
                    unoptimized
                  />
                ) : (
                  <span className="size-6 shrink-0 rounded-full border border-secondary bg-secondary" />
                )}

                <div className="min-w-0 flex-1">
                  <a
                    href={`https://github.com/${person.login}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium hover:text-brand-secondary"
                  >
                    {person.login}
                  </a>

                  {person.name || person.company || person.country ? (
                    <p className="truncate text-xs text-quaternary">
                      {[person.name, person.company, person.country]
                        .filter(Boolean)
                        .join(' \u00B7 ')}
                    </p>
                  ) : null}
                </div>

                <div className="w-28 shrink-0">
                  <p className="num text-right text-xs text-tertiary">
                    {formatCompact(person.contributions)}
                  </p>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-brand-solid"
                      style={{ width: `${Math.max(2, Math.round(share * 100))}%` }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
    </section>
  );
}

function DetailsPanel({ repo }: { repo: RepositoryDetail }) {
  const rows: [label: string, value: React.ReactNode][] = [
    ['Created', formatRelativeTime(repo.githubCreatedAt)],
    ['Last push', formatRelativeTime(repo.githubPushedAt)],
    ['Last release', repo.latestReleaseAt ? formatRelativeTime(repo.latestReleaseAt) : 'none'],
    ['Release tag', repo.latestReleaseTag ?? '\u2014'],
    ['Releases in the last year', repo.releasesLastYear ?? '\u2014'],
    ['Default branch', repo.defaultBranch ?? '\u2014'],
    ['Size', `${formatCompact(repo.sizeKb)} KB`],
    ['Owner type', repo.ownerType ?? '\u2014'],
    ['Owner location', repo.ownerLocation ?? repo.ownerCountry ?? '\u2014'],
    ['Discovered via', repo.discoverySource ?? '\u2014'],
    ['First indexed', formatRelativeTime(repo.firstSeenAt)],
    ['Last synced', repo.lastSyncedAt ? formatRelativeTime(repo.lastSyncedAt) : 'never'],
  ];

  return (
    <Panel className="overflow-hidden">
      <h2 className="border-b border-secondary px-4 py-3 text-sm font-semibold">Details</h2>
      <dl className="divide-y divide-line text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-2">
            <dt className="text-xs text-quaternary">{label}</dt>
            <dd className={cn('num text-right text-xs text-tertiary')}>{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

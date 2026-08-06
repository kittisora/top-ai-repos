import { ArrowRight, Clock, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { query } from '@/components/data';
import { RepoList } from '@/components/repo-list';
import { SearchInput } from '@/components/search-input';
import { EmptyIndexNotice, SetupNotice } from '@/components/setup-notice';
import { LinkButton, Panel, SectionHeader, StatTile } from '@/components/ui';
import { env } from '@/lib/env';
import type { CategoryGroupStats, GlobalStats, RepoListItem } from '@/lib/queries';
import { formatCompact, formatDelta, formatRelativeTime } from '@/lib/utils';

/**
 * Every page in this app reads the database on every request, so none of them
 * can be prerendered — without this the build would bake whatever the database
 * looked like (or did not look like) at build time into a static page.
 */
export const dynamic = 'force-dynamic';

/**
 * Title and description come from the root layout's defaults; only the canonical
 * is declared here, because the layout no longer sets one (it would be inherited
 * by every other route — see the note there).
 */
export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

const LIST_SIZE = 8;

export default async function HomePage() {
  const home = await query(async (q) => {
    // One round of parallel reads rather than six sequential awaits: these are
    // independent queries and the page cannot render until all of them land.
    const [stats, today, week, newest, highestQuality, groups] = await Promise.all([
      q.getGlobalStats(),
      q.getTrendingRepositories('day', LIST_SIZE),
      q.getTrendingRepositories('week', LIST_SIZE),
      q.listRepositories({ sort: 'newest', perPage: LIST_SIZE }),
      q.listRepositories({ sort: 'quality', perPage: LIST_SIZE, minQuality: 60 }),
      q.getCategoryStats(),
    ]);
    return { stats, today, week, newest: newest.items, highestQuality: highestQuality.items, groups };
  });

  return (
    <div className="mx-auto max-w-[100rem] px-4 py-8 sm:px-6">
      <section className="mx-auto max-w-3xl text-center">
        {/* The site name leads the H1 on purpose. This is the landing page for the
            brand/domain query ("top ai repos"), and the <title> already carries the
            phrase while the H1 previously did not — so the page's single strongest
            on-page heading said nothing about what people actually search for.
            `env.siteName` rather than a literal, so it tracks NEXT_PUBLIC_SITE_NAME
            like every other user-facing string. */}
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {env.siteName} — open-source AI, indexed and scored
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-tertiary sm:text-base">
          {env.siteName} tracks AI repositories on GitHub and answers two different questions
          about each one: is it moving right now, and would you bet a product on it.
        </p>
        <SearchInput className="mx-auto mt-6 max-w-xl" target="/repos" />
        <p className="mt-3 text-xs text-quaternary">
          or{' '}
          <Link href="/repos" className="text-brand-secondary hover:underline">
            browse the full explorer
          </Link>{' '}
          ·{' '}
          <Link href="/categories" className="text-brand-secondary hover:underline">
            start from a category
          </Link>
        </p>
      </section>

      {home.error ? (
        <div className="mx-auto mt-10 max-w-3xl">
          <SetupNotice error={home.error} />
        </div>
      ) : (
        <HomeBody data={home.data} />
      )}
    </div>
  );
}

interface HomeData {
  stats: GlobalStats;
  today: RepoListItem[];
  week: RepoListItem[];
  newest: RepoListItem[];
  highestQuality: RepoListItem[];
  groups: CategoryGroupStats[];
}

function HomeBody({ data }: { data: HomeData }) {
  const { stats, today, week, newest, highestQuality, groups } = data;
  const indexEmpty = stats.repositories === 0;

  return (
    <>
      <section aria-label="Index statistics" className="mt-10">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile
            label="Repositories indexed"
            value={formatCompact(stats.repositories)}
            hint={`${stats.categories} categories`}
            href="/repos"
            emphasis
          />
          <StatTile
            label="Stars tracked"
            value={formatCompact(stats.starsTracked)}
            hint={`${formatDelta(stats.starsThisWeek)} this week`}
          />
          <StatTile
            label="Added this week"
            value={formatCompact(stats.reposAddedThisWeek)}
            hint="newly discovered"
            href="/repos?sort=newest"
          />
          <StatTile
            label="Contributors"
            value={formatCompact(stats.contributors)}
            hint={`across ${stats.countries || '—'} countries`}
            href="/contributors"
          />
          <StatTile
            label="Last sync"
            value={
              <span className="text-lg font-medium">
                {stats.lastSyncAt ? formatRelativeTime(stats.lastSyncAt) : 'never'}
              </span>
            }
            hint={stats.lastSyncJob ? `job: ${stats.lastSyncJob}` : 'run npm run ingest'}
          />
        </dl>
      </section>

      {indexEmpty ? (
        <div className="mt-10">
          <EmptyIndexNotice />
        </div>
      ) : (
        <>
          <div className="mt-10 grid gap-8 lg:grid-cols-2">
            <TrendingSection
              title="Trending today"
              subtitle="Biggest star gains in the last 24 hours"
              href="/repos?sort=stars-today"
              repos={today}
              trendWindow="today"
            />
            <TrendingSection
              title="Trending this week"
              subtitle="Biggest star gains over seven days"
              href="/repos?sort=stars-week"
              repos={week}
              trendWindow="this week"
            />
            <TrendingSection
              title="Newly discovered"
              subtitle="Recently created repositories the crawler just found"
              href="/repos?sort=newest"
              repos={newest}
              icon={<Sparkles className="size-3.5" aria-hidden="true" />}
            />
            <TrendingSection
              title="Highest quality"
              subtitle="Maintained, documented and cleanly licensed"
              href="/repos?minQuality=60&sort=quality"
              repos={highestQuality}
              icon={<Clock className="size-3.5" aria-hidden="true" />}
            />
          </div>

          <section className="mt-14" aria-labelledby="browse-heading">
            <SectionHeader
              id="browse-heading"
              title="Browse by category"
              subtitle="Three groups, one primary category per repository."
              action={
                <LinkButton
                  href="/categories"
                  variant="ghost"
                  size="sm"
                  iconTrailing={<ArrowRight className="size-4" aria-hidden="true" />}
                >
                  All categories
                </LinkButton>
              }
            />
            <div className="grid gap-4 lg:grid-cols-3">
              {groups.map((group) => (
                <Panel key={group.slug} className="p-4">
                  <h3 className="text-sm font-semibold">
                    <Link href={`/repos?group=${group.slug}`} className="hover:text-brand-secondary">
                      {group.name}
                    </Link>
                  </h3>
                  <p className="mt-1 text-xs text-tertiary">{group.description}</p>
                  <p className="num mt-2 text-xs text-quaternary">
                    {formatCompact(group.repoCount)} repositories ·{' '}
                    {formatCompact(group.totalStars)} stars
                  </p>
                  <ul className="mt-3 space-y-px">
                    {group.categories.map((category) => (
                      <li key={category.slug}>
                        <Link
                          href={`/categories/${category.slug}`}
                          className="flex items-center justify-between gap-3 rounded px-2 py-1 text-sm text-tertiary transition-colors hover:bg-secondary hover:text-primary"
                        >
                          <span className="truncate">{category.name}</span>
                          <span className="num shrink-0 text-xs text-quaternary">
                            {formatCompact(category.repoCount)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function TrendingSection({
  title,
  subtitle,
  href,
  repos,
  trendWindow,
  icon,
}: {
  title: string;
  subtitle: string;
  href: string;
  repos: RepoListItem[];
  trendWindow?: 'today' | 'this week' | 'this month';
  icon?: React.ReactNode;
}) {
  return (
    // min-w-0 because this is a grid item, and grid items default to
    // `min-width: auto` — they refuse to shrink below their content's
    // min-content width. The repo rows inside contain non-wrapping runs (the
    // trend badge is whitespace-nowrap), so the track was forced to 370px
    // inside a 328px column and the whole page scrolled sideways on a phone.
    <section aria-label={title} className="min-w-0">
      <SectionHeader
        title={title}
        subtitle={subtitle}
        action={
          <LinkButton
            href={href}
            variant="ghost"
            size="sm"
            iconLeading={icon}
            iconTrailing={<ArrowRight className="size-4" aria-hidden="true" />}
          >
            View all
          </LinkButton>
        }
      />
      <RepoList repos={repos} ranked trendWindow={trendWindow} emptyTitle="Nothing here yet" />
    </section>
  );
}

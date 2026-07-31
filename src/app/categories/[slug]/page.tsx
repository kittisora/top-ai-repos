import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { loadCategoryStats } from '@/components/data';
import { RepoExplorer } from '@/components/explorer';
import { toQueryRecord, type RawSearchParams } from '@/components/search-params';
import { StatTile } from '@/components/ui';
import { CATEGORY_BY_SLUG, GROUP_BY_SLUG } from '@/lib/taxonomy';
import { formatCompact, formatDelta } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = CATEGORY_BY_SLUG.get(slug);
  if (!category) return { title: 'Category not found' };

  const canonical = `/categories/${category.slug}`;
  const title = `${category.name} — open-source AI repositories`;
  const description = `${category.description} Browse and compare the best open-source ${category.name} projects on GitHub, ranked by momentum and scored on quality.`;

  return {
    title,
    description,
    keywords: [
      category.name,
      `open source ${category.name}`,
      `best ${category.name} tools`,
      ...category.topics.slice(0, 10),
      'open source AI',
      'GitHub',
    ],
    alternates: { canonical },
    openGraph: { type: 'website', url: canonical, title, description },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const queryParams = toQueryRecord(await searchParams);

  // The taxonomy is code, not data, so an unknown slug is a 404 that can be
  // decided without touching the database.
  const category = CATEGORY_BY_SLUG.get(slug);
  if (!category) notFound();

  const group = GROUP_BY_SLUG.get(category.group);

  // Stats are best-effort: a category page is still worth rendering with the
  // taxonomy copy and the repo list even if the aggregate query fails.
  const stats = await loadCategoryStats();
  const categoryStat = stats.data
    ?.flatMap((entry) => entry.categories)
    .find((entry) => entry.slug === slug);

  return (
    <div className="mx-auto max-w-[100rem] px-4 py-6 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-3 text-xs text-quaternary">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/categories" className="hover:text-primary">
              Categories
            </Link>
          </li>
          {group ? (
            <>
              <li aria-hidden="true">/</li>
              <li>
                <Link href={`/repos?group=${group.slug}`} className="hover:text-primary">
                  {group.name}
                </Link>
              </li>
            </>
          ) : null}
          <li aria-hidden="true">/</li>
          <li className="text-tertiary">{category.name}</li>
        </ol>
      </nav>

      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">{category.name}</h1>
        <p className="mt-1 max-w-2xl text-sm text-tertiary">{category.description}</p>

        {category.topics.length > 0 ? (
          <p className="mt-2 text-xs text-quaternary">
            Signals:{' '}
            <span className="font-mono">{category.topics.slice(0, 8).join(', ')}</span>
          </p>
        ) : null}
      </header>

      {categoryStat ? (
        <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Repositories" value={formatCompact(categoryStat.repoCount)} emphasis />
          <StatTile label="Stars" value={formatCompact(categoryStat.totalStars)} />
          <StatTile
            label="Stars this week"
            value={formatDelta(categoryStat.starsWeek)}
            hint="across the category"
          />
          <StatTile
            label="Median quality"
            value={
              categoryStat.medianQuality === null
                ? '—'
                : Math.round(categoryStat.medianQuality)
            }
            hint="0–100, unscored repos excluded"
          />
        </dl>
      ) : null}

      <RepoExplorer
        pathname={`/categories/${category.slug}`}
        searchParams={queryParams}
        lockedCategory={category.slug}
      />
    </div>
  );
}

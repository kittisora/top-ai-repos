import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { QualityBadge } from '@/components/badges';
import { loadCategoryStats } from '@/components/data';
import { EmptyIndexNotice, SetupNotice } from '@/components/setup-notice';
import { Panel } from '@/components/ui';
import { env } from '@/lib/env';
import { formatCompact, formatDelta } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Categories',
  description:
    `The ${env.siteName} taxonomy: infrastructure, model development and application ` +
    'development, with repository counts, star totals and median quality per category.',
  alternates: { canonical: '/categories' },
};

/**
 * Median score -> the same letter the scorer would assign. The thresholds are
 * duplicated from computeQualityScore because it only grades a whole repo, and
 * a category has no repo to hand it — they must be changed together.
 */
function gradeFor(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

export default async function CategoriesPage() {
  const result = await loadCategoryStats();

  if (result.error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <SetupNotice error={result.error} />
      </div>
    );
  }

  const groups = result.data;
  const totalRepos = groups.reduce((sum, group) => sum + group.repoCount, 0);

  return (
    <div className="mx-auto max-w-[100rem] px-4 py-6 sm:px-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Categories</h1>
        <p className="mt-1 max-w-2xl text-sm text-tertiary">
          Two levels: three broad groups, and a flat list of categories beneath them. Every
          repository gets exactly one primary category — the counts below are primary
          assignments, so they add up.
        </p>
      </header>

      {totalRepos === 0 ? (
        <EmptyIndexNotice what="categorised repositories" />
      ) : (
        <div className="space-y-10">
          {groups.map((group) => (
            <section key={group.slug} aria-labelledby={`group-${group.slug}`}>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                <div>
                  <h2 id={`group-${group.slug}`} className="text-base font-semibold">
                    {group.name}
                  </h2>
                  <p className="mt-0.5 max-w-2xl text-sm text-tertiary">{group.description}</p>
                </div>
                <Link
                  href={`/repos?group=${group.slug}`}
                  className="num shrink-0 text-xs text-brand-secondary hover:underline"
                >
                  {formatCompact(group.repoCount)} repositories ·{' '}
                  {formatCompact(group.totalStars)} stars
                  <ArrowRight className="ml-1 inline size-3" aria-hidden="true" />
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.categories.map((category) => (
                  <Panel
                    key={category.slug}
                    className="relative flex flex-col p-4 transition-colors hover:border-primary"
                  >
                    <h3 className="text-sm font-semibold">
                      {/* Stretched link: the card is the hit area, the accessible
                          name stays the category. */}
                      <Link
                        href={`/categories/${category.slug}`}
                        className="after:absolute after:inset-0 hover:text-brand-secondary"
                      >
                        {category.name}
                      </Link>
                    </h3>
                    {category.description ? (
                      <p className="mt-1 line-clamp-2 flex-1 text-xs text-tertiary">
                        {category.description}
                      </p>
                    ) : (
                      <div className="flex-1" />
                    )}

                    <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <div className="flex items-baseline gap-1">
                        <dt className="text-quaternary">repos</dt>
                        <dd className="num font-semibold">{formatCompact(category.repoCount)}</dd>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <dt className="text-quaternary">stars</dt>
                        <dd className="num">{formatCompact(category.totalStars)}</dd>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <dt className="text-quaternary">7d</dt>
                        <dd className="num text-success-primary">{formatDelta(category.starsWeek)}</dd>
                      </div>
                      <div className="ml-auto flex items-center gap-1">
                        <dt className="text-quaternary">median quality</dt>
                        <dd>
                          <QualityBadge
                            grade={gradeFor(category.medianQuality)}
                            score={
                              category.medianQuality === null
                                ? null
                                : Math.round(category.medianQuality)
                            }
                          />
                        </dd>
                      </div>
                    </dl>
                  </Panel>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

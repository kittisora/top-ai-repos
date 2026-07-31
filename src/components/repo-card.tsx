import { Archive, CircleDot, GitFork, Star, Users } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { CategoryPill, LicenseBadge, QualityBadge, TrendBadge } from '@/components/badges';
import type { RepoListItem } from '@/lib/queries';
import { cn, formatCompact, formatRelativeTime } from '@/lib/utils';

/**
 * One repository as a dense row.
 *
 * Optimised for scanning a list of fifty, not for looking pretty alone: fixed
 * metric column on the right so numbers line up vertically down the page, and
 * every number tabular so the digits do too.
 */
export function RepoCard({
  repo,
  rank,
  trendWindow = 'this week',
  className,
}: {
  repo: RepoListItem;
  /** 1-based position, shown for ranked lists like "trending today". */
  rank?: number;
  trendWindow?: 'today' | 'this week' | 'this month';
  className?: string;
}) {
  const href = `/repos/${repo.ownerLogin}/${repo.name}`;
  const delta =
    trendWindow === 'today'
      ? repo.starsDay
      : trendWindow === 'this month'
        ? repo.starsMonth
        : repo.starsWeek;

  return (
    <article
      className={cn(
        'group relative flex gap-3 border-b border-secondary px-3.5 py-3 last:border-b-0',
        'transition-colors hover:bg-secondary',
        className,
      )}
    >
      {rank !== undefined ? (
        <div className="num w-6 shrink-0 pt-0.5 text-right text-sm font-medium text-quaternary">
          {rank}
        </div>
      ) : null}

      {repo.ownerAvatarUrl ? (
        <Image
          src={repo.ownerAvatarUrl}
          alt=""
          width={28}
          height={28}
          className="mt-0.5 hidden size-7 shrink-0 rounded border border-secondary bg-secondary sm:block"
          unoptimized
        />
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="min-w-0 text-sm font-semibold tracking-tight">
            {/* Stretched link: the whole row is the target, but the accessible
                name stays just the repository, and nested links below still
                win because they sit above it in the stacking order. */}
            <Link href={href} className="after:absolute after:inset-0 hover:text-brand-secondary">
              <span className="text-tertiary">{repo.ownerLogin}/</span>
              <span className="break-all">{repo.name}</span>
            </Link>
          </h3>

          <QualityBadge grade={repo.qualityGrade} score={repo.qualityScore} />

          {repo.isArchived ? (
            <span className="inline-flex items-center gap-1 rounded border border-secondary px-1.5 text-xs text-quaternary">
              <Archive className="size-3" aria-hidden="true" />
              Archived
            </span>
          ) : null}

          {repo.isFork ? (
            <span className="rounded border border-secondary px-1.5 text-xs text-quaternary">Fork</span>
          ) : null}
        </div>

        {repo.description ? (
          <p className="mt-1 line-clamp-2 text-sm text-tertiary">{repo.description}</p>
        ) : (
          <p className="mt-1 text-sm italic text-quaternary">No description</p>
        )}

        <div className="relative z-10 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {repo.primaryCategory ? (
            <CategoryPill
              name={repo.primaryCategory.name}
              href={`/categories/${repo.primaryCategory.slug}`}
              primary
            />
          ) : null}
          {repo.categories
            .filter((c) => c.slug !== repo.primaryCategory?.slug)
            .slice(0, 2)
            .map((c) => (
              <CategoryPill key={c.slug} name={c.name} href={`/categories/${c.slug}`} />
            ))}
          {repo.language ? (
            <Link
              href={`/repos?language=${encodeURIComponent(repo.language)}`}
              className="text-xs text-tertiary transition-colors hover:text-primary"
            >
              {repo.language}
            </Link>
          ) : null}
          <LicenseBadge licenseClass={repo.licenseClass} spdxId={repo.licenseSpdxId} />
        </div>
      </div>

      <dl className="flex shrink-0 flex-col items-end gap-1 text-xs text-tertiary">
        <div className="flex items-center gap-1">
          <Star className="size-3.5 text-quaternary" aria-hidden="true" />
          <dt className="sr-only">stars</dt>
          <dd className="num font-semibold text-primary">{formatCompact(repo.stars)}</dd>
        </div>

        <div>
          <dt className="sr-only">stars gained {trendWindow}</dt>
          <dd>
            <TrendBadge value={delta} window={trendWindow} />
          </dd>
        </div>

        <div className="hidden items-center gap-2.5 sm:flex">
          <span className="flex items-center gap-1" title={`${repo.forks} forks`}>
            <GitFork className="size-3 text-quaternary" aria-hidden="true" />
            <span className="num">{formatCompact(repo.forks)}</span>
          </span>
          <span className="flex items-center gap-1" title={`${repo.openIssues} open issues`}>
            <CircleDot className="size-3 text-quaternary" aria-hidden="true" />
            <span className="num">{formatCompact(repo.openIssues)}</span>
          </span>
          {repo.contributorsCount !== null ? (
            <span
              className="flex items-center gap-1"
              title={`${repo.contributorsCount} contributors`}
            >
              <Users className="size-3 text-quaternary" aria-hidden="true" />
              <span className="num">{formatCompact(repo.contributorsCount)}</span>
            </span>
          ) : null}
        </div>

        <div className="hidden text-quaternary md:block">
          <dt className="sr-only">last push</dt>
          <dd>{formatRelativeTime(repo.githubPushedAt)}</dd>
        </div>
      </dl>
    </article>
  );
}

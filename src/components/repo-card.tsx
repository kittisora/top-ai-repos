import { Archive, CircleDot, GitFork, Star, Users } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { CategoryPill, LicenseBadge, QualityBadge, TrendBadge } from '@/components/badges';
import type { RepoListItem } from '@/lib/queries';
import { cn, formatCompact, formatRelativeTime, githubAvatarUrl } from '@/lib/utils';

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
          // 56 = 2x the 28px it renders at, for retina. Without this GitHub
          // serves the original upload (~22 KB) — 24 of them per page of results.
          src={githubAvatarUrl(repo.ownerAvatarUrl, 56)}
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
            /* The visible pill stays just the language name, but the link needs
               more than that to be a good link. Lighthouse's link-text audit keeps
               a blocklist of non-descriptive anchor text, and a one-word language
               name lands on it verbatim — "Go" is a literal entry. That is the
               "Links do not have descriptive text — 2 links found" on the
               homepage. The sr-only suffix fixes the accessible name and the
               crawlable text at once without changing what anyone sees. */
            <Link
              href={`/repos?language=${encodeURIComponent(repo.language)}`}
              className="text-xs text-tertiary transition-colors hover:text-primary"
            >
              {repo.language}
              <span className="sr-only"> repositories</span>
            </Link>
          ) : null}
          <LicenseBadge licenseClass={repo.licenseClass} spdxId={repo.licenseSpdxId} />
        </div>
      </div>

      <dl className="flex shrink-0 flex-col items-end gap-1 text-xs text-tertiary">
        {/* The icon lives INSIDE the <dd>, not beside it. A <div> child of a <dl>
            may contain only <dt>/<dd> (plus script/template), so an <svg> sibling
            makes the whole list invalid — Lighthouse reports it as "<dl>'s do not
            contain only properly-ordered <dt> and <dd> groups". Rendering is
            unchanged: `sr-only` makes the <dt> absolutely positioned, so it never
            occupied a slot in this flex row and the gap-1 always sat between the
            icon and the number. */}
        <div className="flex items-center">
          <dt className="sr-only">stars</dt>
          <dd className="num flex items-center gap-1 font-semibold text-primary">
            <Star className="size-3.5 text-quaternary" aria-hidden="true" />
            {formatCompact(repo.stars)}
          </dd>
        </div>

        <div>
          <dt className="sr-only">stars gained {trendWindow}</dt>
          <dd>
            <TrendBadge value={delta} window={trendWindow} />
          </dd>
        </div>

        {/* This row held three bare <span>s and no <dt>/<dd> at all, which is the
            same violation again. It hid on mobile (`hidden … sm:flex`), so axe
            skipped it under Lighthouse's default phone emulation and it only
            surfaced in a desktop audit — the kind of bug that looks fixed until
            someone runs the report at a different width.

            Now one name/value group: an sr-only <dt> naming the row, and a <dd>
            that carries the flex layout the outer div used to. */}
        <div className="hidden sm:block">
          <dt className="sr-only">forks, open issues and contributors</dt>
          <dd className="flex items-center gap-2.5">
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
          </dd>
        </div>

        <div className="hidden text-quaternary md:block">
          <dt className="sr-only">last push</dt>
          <dd>{formatRelativeTime(repo.githubPushedAt)}</dd>
        </div>
      </dl>
    </article>
  );
}

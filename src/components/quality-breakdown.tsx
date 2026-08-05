import { AlertTriangle, Check } from 'lucide-react';

import { LICENSE_HINT, QualityBadge } from '@/components/badges';
import type { RepositoryDetail } from '@/lib/queries';
import { computeQualityScore } from '@/lib/scoring';
import { cn } from '@/lib/utils';

/**
 * The quality score, opened up.
 *
 * The headline score and grade are the *stored* ones, computed by the scoring
 * pass so that what is shown here matches what the listing sorted by. The
 * per-dimension bars are recomputed from the same columns the scorer read,
 * because only the total is persisted — `computeQualityScore` is a pure
 * function of data we already have on this page, so this costs nothing and
 * cannot disagree with the total by more than one sync's worth of drift.
 */

const DIMENSIONS: {
  key: keyof ReturnType<typeof computeQualityScore>['dimensions'];
  label: string;
  explains: string;
}[] = [
  {
    key: 'maintenance',
    label: 'Maintenance',
    explains: 'How recently the default branch was pushed to',
  },
  { key: 'releases', label: 'Releases', explains: 'Recency and cadence of tagged releases' },
  { key: 'community', label: 'Community', explains: 'Contributor breadth and bus factor' },
  {
    key: 'responsiveness',
    label: 'Issue backlog',
    explains: 'Open issues measured against the size of the audience',
  },
  {
    key: 'documentation',
    label: 'Documentation',
    explains: 'README depth, plus a homepage and topics',
  },
  { key: 'licensing', label: 'Licensing', explains: 'How freely the code can be adopted' },
];

export function QualityBreakdown({ repo }: { repo: RepositoryDetail }) {
  const breakdown = computeQualityScore({
    stars: repo.stars,
    forks: repo.forks,
    openIssues: repo.openIssues,
    contributorsCount: repo.contributorsCount,
    topContributorShare: repo.topContributorShare,
    pushedAt: repo.githubPushedAt,
    createdAt: repo.githubCreatedAt,
    latestReleaseAt: repo.latestReleaseAt,
    releasesLastYear: repo.releasesLastYear,
    licenseSpdxId: repo.licenseSpdxId,
    readmeLength: repo.readmeLength,
    hasHomepage: Boolean(repo.homepage),
    hasDescription: Boolean(repo.description),
    topicsCount: repo.topics.length,
    isArchived: repo.isArchived,
    isFork: repo.isFork,
  });

  const score = repo.qualityScore ?? breakdown.score;
  const grade = repo.qualityGrade ?? breakdown.grade;
  const flags = repo.qualityFlags.length > 0 ? repo.qualityFlags : breakdown.flags;

  return (
    <div className="rounded-lg border border-secondary bg-primary">
      <div className="flex items-center justify-between gap-4 border-b border-secondary px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Quality score</h2>
          <p className="mt-0.5 text-xs text-tertiary">
            Would you bet a product on this? Bounded 0–100 and slow moving.
          </p>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="num text-2xl font-semibold tracking-tight">{score}</span>
          <span className="text-xs text-quaternary">/100</span>
          <QualityBadge grade={grade} score={score} size="md" />
        </div>
      </div>

      <dl className="divide-y divide-line">
        {DIMENSIONS.map((dimension) => {
          const value = breakdown.dimensions[dimension.key];
          const percent = Math.round(value * 100);
          return (
            /*
             * Flat dt + dd + dd, because a <div> inside a <dl> may hold nothing
             * else. Previously this row wrapped the <dt>/<dd> in a second flex
             * <div> and sat them alongside the meter and a <p>, which tripped both
             * of Lighthouse's definition-list rules at once: non-dt/dd content in
             * a <dl>-child div, and dt/dd whose nearest legal ancestor was two
             * divs down rather than the <dl> itself.
             *
             * A 2-column grid on the row reproduces the old
             * `flex items-baseline justify-between` pairing of label and
             * percentage without needing the inner div, and the meter and prose
             * become <dd>s of the same group — which they always were in meaning.
             */
            <div
              key={dimension.key}
              className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 px-4 py-2.5"
            >
              <dt className="text-sm font-medium">{dimension.label}</dt>
              <dd className="num text-xs text-tertiary">{percent}%</dd>
              <dd
                className="col-span-2 mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary"
                role="meter"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${dimension.label}: ${percent} out of 100`}
              >
                <div
                  className={cn(
                    'h-full rounded-full',
                    percent >= 70 ? 'bg-grade-a' : percent >= 40 ? 'bg-grade-c' : 'bg-grade-f',
                  )}
                  style={{ width: `${percent}%` }}
                />
              </dd>
              <dd className="col-span-2 mt-1 text-xs text-quaternary">{dimension.explains}</dd>
            </div>
          );
        })}
      </dl>

      <div className="border-t border-secondary px-4 py-3">
        <h3 className="text-xs font-medium uppercase tracking-wider text-quaternary">
          What to know before adopting
        </h3>
        <ul className="mt-2 space-y-1.5 text-sm">
          {flags.length === 0 ? (
            <li className="flex items-start gap-2 text-tertiary">
              <Check className="mt-0.5 size-3.5 shrink-0 text-success-primary" aria-hidden="true" />
              Nothing flagged — maintained, documented and cleanly licensed.
            </li>
          ) : (
            flags.map((flag) => (
              <li key={flag} className="flex items-start gap-2 text-tertiary">
                <AlertTriangle
                  className="mt-0.5 size-3.5 shrink-0 text-warning-primary"
                  aria-hidden="true"
                />
                {flag}
              </li>
            ))
          )}
          <li className="flex items-start gap-2 text-tertiary">
            <Check className="mt-0.5 size-3.5 shrink-0 text-quaternary" aria-hidden="true" />
            {LICENSE_HINT[repo.licenseClass]}.
          </li>
        </ul>
      </div>
    </div>
  );
}

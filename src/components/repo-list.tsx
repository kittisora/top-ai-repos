import { EmptyIndexNotice } from '@/components/setup-notice';
import { RepoCard } from '@/components/repo-card';
import { EmptyState, LinkButton } from '@/components/ui';
import type { RepoListItem } from '@/lib/queries';
import { cn } from '@/lib/utils';

/**
 * A list of repositories plus the two things a list is useless without: a
 * distinction between "nothing matched your filters" and "nothing is indexed
 * yet", and a way out of each.
 */
export function RepoList({
  repos,
  ranked = false,
  trendWindow,
  /** True when the whole index is empty, not just this filtered view. */
  indexEmpty = false,
  emptyTitle = 'No repositories match these filters',
  emptyAction,
  className,
}: {
  repos: RepoListItem[];
  ranked?: boolean;
  trendWindow?: 'today' | 'this week' | 'this month';
  indexEmpty?: boolean;
  emptyTitle?: string;
  emptyAction?: React.ReactNode;
  className?: string;
}) {
  if (repos.length === 0) {
    if (indexEmpty) return <EmptyIndexNotice />;
    return (
      <EmptyState
        title={emptyTitle}
        action={
          emptyAction ?? (
            <>
              <LinkButton href="/repos">Clear all filters</LinkButton>
              <LinkButton href="/submit" variant="ghost">
                Submit a missing repository
              </LinkButton>
            </>
          )
        }
      >
        Try widening the star or quality thresholds, or removing the language filter.
      </EmptyState>
    );
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border border-secondary bg-primary', className)}>
      {repos.map((repo, index) => (
        <RepoCard
          key={repo.id}
          repo={repo}
          rank={ranked ? index + 1 : undefined}
          trendWindow={trendWindow}
        />
      ))}
    </div>
  );
}

import { Star } from 'lucide-react';
import { Suspense, type ReactNode } from 'react';

import { Skeleton } from '@/components/ui';
import { env } from '@/lib/env';
import { getSourceRepoStars } from '@/lib/github/stars';
import { cn, formatCompact, formatNumber } from '@/lib/utils';

/**
 * How many people have starred THIS project, in the header.
 *
 * A server component, because the count comes from GitHub and is shared by every
 * visitor: fetching it in the browser would mean a third-party request per page
 * load and a number that pops in after hydration. The header is a client
 * component, so the root layout passes this in as a slot (see @/components/header).
 *
 * The fetch sits behind its own Suspense boundary so the header — which is the
 * first thing in the page shell — streams immediately and the badge fills in when
 * GitHub answers, rather than holding up the whole response on a cold cache.
 */
export function GitHubStarBadge({ className }: { className?: string }) {
  return (
    <Suspense
      fallback={
        <StarPill className={className}>
          <Skeleton className="h-3 w-6" />
        </StarPill>
      }
    >
      <ResolvedStarBadge className={className} />
    </Suspense>
  );
}

async function ResolvedStarBadge({ className }: { className?: string }) {
  const stars = await getSourceRepoStars();
  return (
    <StarPill className={className} stars={stars}>
      {stars === null ? null : <span className="num">{formatCompact(stars)}</span>}
    </StarPill>
  );
}

/**
 * The pill itself, shared by the resolved badge and its loading state so the two
 * are the same size and nothing shifts when the count arrives. Styling follows
 * the header's own floating pill — same ring token — and the theme toggle's 32px
 * box, so the two sit level next to each other.
 */
function StarPill({
  children,
  stars,
  className,
}: {
  /** The count, a skeleton, or nothing at all when GitHub is unreachable. */
  children: ReactNode;
  stars?: number | null;
  className?: string;
}) {
  const label =
    stars === null || stars === undefined
      ? `Star ${env.sourceRepo} on GitHub`
      : `Star ${env.sourceRepo} on GitHub — ${formatNumber(stars)} stars`;

  return (
    <a
      href={`https://github.com/${env.sourceRepo}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium',
        'text-tertiary ring-1 ring-inset ring-secondary transition-colors',
        'hover:bg-primary_hover hover:text-secondary',
        // Below 360px there is no room for it: the header's wordmark does not
        // shrink, so the badge and "Top AI Repos" overlap (measured on a 320px
        // viewport). Every current phone is 360 CSS px or wider; the ones that
        // are not keep the header they had before this badge existed.
        'max-[359px]:hidden',
        className,
      )}
    >
      <Star className="size-4 shrink-0" aria-hidden="true" />
      {children}
    </a>
  );
}

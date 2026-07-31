import { ArrowLeft, ArrowRight } from '@untitledui/icons';
import Link from 'next/link';

import { Button } from '@/components/base/buttons/button';
import { buildHref } from '@/components/search-params';
import { cx } from '@/utils/cx';

/**
 * Offset pagination in Untitled UI's visual language, rendered as LINKS.
 *
 * Two deliberate choices:
 *
 * 1. Links, not buttons. Every page of every filtered view is a real URL, so it
 *    can be shared, the back button does the obvious thing, and Googlebot can
 *    reach pages 2..N of a 29k-repo index.
 * 2. The page window is computed here rather than by UUI's `Pagination.Root`.
 *    Root seeds its page list with `useState([])` and fills it in an effect, so
 *    it renders NOTHING on the server — the page links would be invisible to
 *    crawlers and flash in after hydration. We keep UUI's Button, its exact item
 *    classes and its arrow icons, and do the arithmetic ourselves so the control
 *    is server-rendered and this stays a plain server component.
 */

/** Copied from UUI's own PaginationItem so these links look native to the set. */
const itemClass = (isSelected: boolean) =>
  cx(
    'flex size-9 items-center justify-center rounded-lg p-3 text-sm font-medium',
    'outline-focus-ring transition duration-100 ease-linear',
    'hover:bg-primary_hover hover:text-secondary focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2',
    isSelected ? 'bg-primary_hover text-secondary' : 'text-quaternary',
  );

export function Pagination({
  page,
  totalPages,
  total,
  perPage,
  pathname,
  params,
}: {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  pathname: string;
  /** Current query string, so paging preserves every active filter. */
  params: Record<string, string>;
}) {
  if (totalPages <= 1) {
    return total > 0 ? (
      <p className="num py-3 text-center text-xs text-quaternary">
        {total.toLocaleString()} {total === 1 ? 'repository' : 'repositories'}
      </p>
    ) : null;
  }

  const first = (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);
  const href = (target: number) =>
    buildHref(pathname, params, { page: target === 1 ? undefined : target });

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-secondary py-4"
    >
      <p className="num shrink-0 text-xs text-tertiary">
        {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}
      </p>

      <div className="flex items-center gap-0.5">
        {page > 1 ? (
          <Button
            href={href(page - 1)}
            color="link-gray"
            size="sm"
            iconLeading={<ArrowLeft data-icon className="size-4" />}
            aria-label="Previous page"
            className="mr-1"
          >
            <span className="max-sm:hidden">Previous</span>
          </Button>
        ) : null}

        {windowedPages(page, totalPages).map((entry, index) =>
          entry === 'gap' ? (
            <span
              key={`gap-${index}`}
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center text-tertiary select-none"
            >
              &#8230;
            </span>
          ) : (
            <Link
              key={entry}
              href={href(entry)}
              aria-label={`Page ${entry}`}
              aria-current={entry === page ? 'page' : undefined}
              className={cx('num', itemClass(entry === page))}
            >
              {entry}
            </Link>
          ),
        )}

        {page < totalPages ? (
          <Button
            href={href(page + 1)}
            color="link-gray"
            size="sm"
            iconTrailing={<ArrowRight data-icon className="size-4" />}
            aria-label="Next page"
            className="ml-1"
          >
            <span className="max-sm:hidden">Next</span>
          </Button>
        ) : null}
      </div>
    </nav>
  );
}

/**
 * First, last, and a window around the current page — the same shape UUI's Root
 * produces, so the control stays a fixed width whether there are 3 pages or 300.
 */
function windowedPages(page: number, totalPages: number): (number | 'gap')[] {
  const span = 1;
  const wanted = new Set<number>([1, totalPages, page]);
  for (let offset = 1; offset <= span; offset += 1) {
    if (page - offset >= 1) wanted.add(page - offset);
    if (page + offset <= totalPages) wanted.add(page + offset);
  }

  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  let previous = 0;

  for (const value of sorted) {
    if (previous !== 0 && value - previous > 1) out.push('gap');
    out.push(value);
    previous = value;
  }

  return out;
}

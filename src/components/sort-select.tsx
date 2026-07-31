'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { Select } from '@/components/base/select/select';
import type { RepoSort } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** Label copy says what the sort *does*, not what the column is called. */
const SORT_OPTIONS: { id: RepoSort; label: string; searchOnly?: boolean }[] = [
  { id: 'trending', label: 'Trending — momentum' },
  { id: 'stars-today', label: 'Stars gained today' },
  { id: 'stars-week', label: 'Stars gained this week' },
  { id: 'stars-month', label: 'Stars gained this month' },
  { id: 'velocity', label: 'Growth rate — relative' },
  { id: 'stars', label: 'Total stars' },
  { id: 'quality', label: 'Quality score' },
  { id: 'newest', label: 'Newest repositories' },
  { id: 'recently-updated', label: 'Recently pushed' },
  { id: 'relevance', label: 'Best match', searchOnly: true },
];

export function SortSelect({
  value,
  pathname,
  className,
}: {
  value: RepoSort;
  pathname: string;
  className?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // "Best match" against an empty query ranks nothing, so it is only offered
  // when there is something to rank against.
  const hasQuery = Boolean(searchParams.get('q'));
  const items = SORT_OPTIONS.filter((option) => !option.searchOnly || hasQuery);

  function onChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'trending') params.delete('sort');
    else params.set('sort', next);
    // Re-sorting reshuffles everything; page 7 of the old order is meaningless.
    params.delete('page');
    params.sort();

    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="shrink-0 text-xs font-medium text-tertiary">Sort</span>
      <Select
        aria-label="Sort repositories"
        size="sm"
        selectedKey={value}
        onSelectionChange={(key) => onChange(String(key))}
        items={items}
        className="w-56"
      >
        {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
      </Select>
    </div>
  );
}

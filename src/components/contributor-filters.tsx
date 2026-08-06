'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/base/buttons/button';
import { FilterSelect } from '@/components/filter-select';
import type { CategoryGroupStats, CountryStat } from '@/lib/queries';

/**
 * The contributors filter row, on  Select / Button.
 *
 * react-aria's Select is not a native form field, so — exactly like the
 * explorer's filter sidebar — this is a client component that gathers state and
 * pushes a URL on Apply. Every filtered view stays a shareable link.
 */

type Item = { id: string; label: string };

export function ContributorFilters({
  countries,
  groups,
  country: initialCountry,
  category: initialCategory,
  total,
}: {
  countries: CountryStat[];
  groups: CategoryGroupStats[];
  country?: string;
  category?: string;
  total: number;
}) {
  const router = useRouter();
  const [country, setCountry] = useState(initialCountry ?? '');
  const [category, setCategory] = useState(initialCategory ?? '');

  const countryItems: Item[] = [
    { id: '', label: 'Everywhere' },
    ...countries
      .filter((entry) => entry.contributorCount > 0)
      .map((entry) => ({
        id: entry.country,
        label: `${entry.country} (${entry.contributorCount})`,
      })),
  ];

  // Flattened rather than grouped: react-aria's ListBox has no <optgroup>, so
  // the group name is folded into the label to keep the taxonomy legible.
  const categoryItems: Item[] = [
    { id: '', label: 'Any category' },
    ...groups.flatMap((group) =>
      group.categories.map((entry) => ({
        id: entry.slug,
        label: `${group.name} · ${entry.name}`,
      })),
    ),
  ];

  const filtered = Boolean(initialCountry || initialCategory);

  function apply() {
    const next = new URLSearchParams();
    if (country) next.set('country', country);
    if (category) next.set('category', category);
    next.sort();
    const qs = next.toString();
    router.push(qs ? `/contributors?${qs}` : '/contributors');
  }

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-secondary bg-primary p-3 shadow-xs">
      {/* Both lists run well past ten options, so FilterSelect gives each a
          search box automatically. */}
      <FilterSelect
        label="Country"
        placeholder="Everywhere"
        items={countryItems}
        selectedKey={country}
        onChange={setCountry}
        className="w-48"
      />

      <FilterSelect
        label="Category"
        placeholder="Any category"
        items={categoryItems}
        selectedKey={category}
        onChange={setCategory}
        className="w-64"
      />

      <Button size="sm" color="primary" onClick={apply}>
        Apply
      </Button>
      {filtered ? (
        <Button href="/contributors" size="sm" color="tertiary">
          Clear
        </Button>
      ) : null}

      <p className="num ml-auto text-xs text-tertiary">
        {total.toLocaleString()} {total === 1 ? 'person' : 'people'}
      </p>
    </div>
  );
}

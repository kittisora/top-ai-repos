'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { LICENSE_LABEL } from '@/components/badges';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Input } from '@/components/base/input/input';
import { CollapsiblePanel } from '@/components/collapsible-panel';
import { FilterSelect } from '@/components/filter-select';
import { buildFilterHref } from '@/components/search-params';
import { LICENSE_CLASSES } from '@/lib/api/validation';
import type { CategoryGroupStats, CountryStat, LanguageStat } from '@/lib/queries';
import { cn, formatCompact } from '@/lib/utils';

/**
 * The explorer's filter panel, built on Untitled UI Select / Checkbox / Input /
 * Button.
 *
 * react-aria controls are not native form fields, so this is a client component
 * that gathers its state and pushes a URL on Apply — every filtered view is
 * still a shareable link, which is the whole point of keeping filters in the
 * query string.
 */

type Item = { id: string; label: string };

/** An empty id ("") is the "Any …" option — cleared from the URL on apply. */
const anyItem = (label: string): Item => ({ id: '', label });

export function FilterSidebar({
  action,
  params,
  groups,
  languages,
  countries,
  lockedCategory,
}: {
  action: string;
  params: Record<string, string>;
  groups: CategoryGroupStats[];
  languages: LanguageStat[];
  countries: CountryStat[];
  lockedCategory?: string;
}) {
  const router = useRouter();

  const [group, setGroup] = useState(params.group ?? '');
  const [category, setCategory] = useState(params.category ?? '');
  const [language, setLanguage] = useState(params.language ?? '');
  const [license, setLicense] = useState(params.license ?? '');
  const [country, setCountry] = useState(params.country ?? '');
  const [minStars, setMinStars] = useState(params.minStars ?? '');
  const [minQuality, setMinQuality] = useState(params.minQuality ?? '');
  const [includeArchived, setIncludeArchived] = useState(params.includeArchived === 'true');

  const groupItems: Item[] = [
    anyItem('Any group'),
    ...groups.map((g) => ({ id: g.slug, label: `${g.name} (${g.repoCount})` })),
  ];
  const categoryItems: Item[] = [
    anyItem('Any category'),
    ...groups.flatMap((g) => g.categories.map((c) => ({ id: c.slug, label: `${c.name} (${c.repoCount})` }))),
  ];
  const languageItems: Item[] = [
    anyItem('Any language'),
    ...languages.map((l) => ({ id: l.language, label: `${l.language} (${l.repoCount})` })),
  ];
  const licenseItems: Item[] = [
    anyItem('Any licence'),
    ...LICENSE_CLASSES.map((value) => ({ id: value, label: LICENSE_LABEL[value] })),
  ];
  const countryItems: Item[] = [
    anyItem('Anywhere'),
    ...countries.map((c) => ({ id: c.country, label: `${c.country} (${c.repoCount})` })),
  ];

  function apply() {
    const next = new URLSearchParams();
    // The search box and sort control live outside this panel; preserve them.
    if (params.q) next.set('q', params.q);
    if (params.sort) next.set('sort', params.sort);

    const entries: [string, string][] = lockedCategory
      ? [['language', language], ['license', license], ['country', country]]
      : [
          ['group', group],
          ['category', category],
          ['language', language],
          ['license', license],
          ['country', country],
        ];
    for (const [key, value] of entries) if (value) next.set(key, value);
    if (minStars.trim()) next.set('minStars', minStars.trim());
    if (minQuality.trim()) next.set('minQuality', minQuality.trim());
    if (includeArchived) next.set('includeArchived', 'true');
    next.sort();

    const qs = next.toString();
    router.push(qs ? `${action}?${qs}` : action);
  }

  return (
    <CollapsiblePanel label="Filters">
      <div className="space-y-4 rounded-xl border border-secondary bg-primary p-3.5 shadow-xs">
        {/* FilterSelect adds a search box on its own once a list passes ~10
            options, so Language (175) and Category (33) are searchable while
            Group (3) and Licence (6) stay plain listboxes. */}
        {lockedCategory ? null : (
          <>
            <FilterSelect
              label="Group"
              placeholder="Any group"
              items={groupItems}
              selectedKey={group}
              onChange={setGroup}
            />

            <FilterSelect
              label="Category"
              placeholder="Any category"
              items={categoryItems}
              selectedKey={category}
              onChange={setCategory}
            />
          </>
        )}

        <div>
          <FilterSelect
            label="Language"
            placeholder="Any language"
            items={languageItems}
            selectedKey={language}
            onChange={setLanguage}
          />
          {languages.length === 0 ? <Hint>Populated after the first sync.</Hint> : null}
        </div>

        <FilterSelect
          label="Licence"
          placeholder="Any licence"
          items={licenseItems}
          selectedKey={license}
          onChange={setLicense}
        />

        <div>
          <FilterSelect
            label="Owner country"
            placeholder="Anywhere"
            items={countryItems}
            selectedKey={country}
            onChange={setCountry}
          />
          {countries.length === 0 ? <Hint>Populated after the first sync.</Hint> : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            size="sm"
            label="Min stars"
            aria-label="Minimum stars"
            type="number"
            placeholder="0"
            value={minStars}
            onChange={setMinStars}
          />
          <Input
            size="sm"
            label="Min quality"
            aria-label="Minimum quality"
            type="number"
            placeholder="0–100"
            value={minQuality}
            onChange={setMinQuality}
          />
        </div>

        <Checkbox
          size="sm"
          label="Include archived repositories"
          isSelected={includeArchived}
          onChange={setIncludeArchived}
        />

        <div className="flex items-center gap-2 border-t border-secondary pt-3">
          <Button size="sm" color="primary" className="flex-1" onClick={apply}>
            Apply filters
          </Button>
          <Button size="sm" color="tertiary" href={action}>
            Reset
          </Button>
        </div>
      </div>
    </CollapsiblePanel>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs text-quaternary">{children}</p>;
}

// ---------------------------------------------------------------------------
// Active filter chips
// ---------------------------------------------------------------------------

/**
 * Shows what is actually narrowing the result set, with a one-click removal for
 * each. Without this a stale `minStars=5000` in the URL reads as "the index is
 * nearly empty" and the user has no idea why.
 */
export function ActiveFilters({
  pathname,
  params,
  exclude = [],
  countLabel,
}: {
  pathname: string;
  params: Record<string, string>;
  /** Keys owned by the route rather than the user (e.g. the category slug). */
  exclude?: string[];
  countLabel?: string;
}) {
  const LABELS: Record<string, (value: string) => string> = {
    q: (value) => `“${value}”`,
    category: (value) => `Category: ${value}`,
    group: (value) => `Group: ${value}`,
    language: (value) => `Language: ${value}`,
    license: (value) => `Licence: ${LICENSE_LABEL[value as keyof typeof LICENSE_LABEL] ?? value}`,
    country: (value) => `Country: ${value}`,
    minStars: (value) => `≥ ${formatCompact(Number(value))} stars`,
    maxStars: (value) => `≤ ${formatCompact(Number(value))} stars`,
    minQuality: (value) => `Quality ≥ ${value}`,
    createdAfter: (value) => `Created after ${value}`,
    pushedAfter: (value) => `Pushed after ${value}`,
    includeArchived: () => 'Including archived',
  };

  const active = Object.entries(params).filter(
    ([key, value]) => key in LABELS && value !== '' && !exclude.includes(key),
  );

  if (active.length === 0) {
    return countLabel ? <p className="num text-xs text-tertiary">{countLabel}</p> : null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {countLabel ? <span className="num mr-1 text-xs text-tertiary">{countLabel}</span> : null}
      {active.map(([key, value]) => (
        <Link
          key={key}
          href={buildFilterHref(pathname, params, { [key]: undefined })}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border border-secondary bg-secondary',
            'px-2 py-0.5 text-xs text-tertiary hover:border-primary hover:text-primary',
          )}
        >
          {LABELS[key]!(value)}
          <X className="size-3" aria-hidden="true" />
          <span className="sr-only">Remove filter</span>
        </Link>
      ))}
      <Link
        href={buildFilterHref(
          pathname,
          // Route-owned keys survive "clear all"; user-chosen ones do not.
          Object.fromEntries(exclude.flatMap((key) => (params[key] ? [[key, params[key]]] : []))),
          {},
        )}
        className="ml-1 text-xs text-brand-secondary hover:underline"
      >
        Clear all
      </Link>
    </div>
  );
}

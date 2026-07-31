'use client';

import { SearchLg, X } from '@untitledui/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/base/buttons/button';
import { InputBase } from '@/components/base/input/input';
import { InputGroup } from '@/components/base/input/input-group';
import { cn } from '@/lib/utils';

/**
 * Full-text search over the index, on Untitled UI's InputGroup.
 *
 * A real <form> with a real submit, so Enter works and the query ends up in the
 * URL — search results have to be linkable like every other view. Submitting
 * keeps whatever filters are already applied and always returns to page 1,
 * because the result set just changed underneath the offset.
 */
export function SearchInput({
  target = '/repos',
  placeholder = 'Search repositories, topics, descriptions…',
  defaultValue = '',
  autoFocus = false,
  className,
}: {
  target?: string;
  placeholder?: string;
  defaultValue?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(defaultValue);

  function pushQuery(query: string) {
    const next = new URLSearchParams(searchParams.toString());
    const trimmed = query.trim();

    if (trimmed) next.set('q', trimmed);
    else {
      next.delete('q');
      // `relevance` ranks against the query; with no query it means nothing and
      // the query layer would silently fall back anyway. Say so in the URL.
      if (next.get('sort') === 'relevance') next.delete('sort');
    }
    next.delete('page');
    next.sort();

    const qs = next.toString();
    router.push(qs ? `${target}?${qs}` : target);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    pushQuery(value);
  }

  return (
    <form role="search" onSubmit={onSubmit} className={cn('w-full', className)}>
      <InputGroup
        size="md"
        aria-label="Search repositories"
        value={value}
        onChange={setValue}
        trailingAddon={
          <div className="flex items-center gap-1">
            {defaultValue ? (
              <Button
                type="button"
                size="sm"
                color="tertiary"
                aria-label="Clear search"
                iconLeading={<X data-icon className="size-4" />}
                onClick={() => {
                  setValue('');
                  pushQuery('');
                }}
              />
            ) : null}
            <Button type="submit" size="sm" color="secondary">
              Search
            </Button>
          </div>
        }
      >
        <InputBase
          name="q"
          type="search"
          autoFocus={autoFocus}
          placeholder={placeholder}
          icon={SearchLg}
        />
      </InputGroup>
    </form>
  );
}

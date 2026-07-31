'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFilter } from 'react-aria-components';

import { Select } from '@/components/base/select/select';
import { narrowItems, SEARCHABLE_THRESHOLD } from '@/lib/filter-items';

/**
 * One dropdown for every filter, which decides for itself whether it needs a
 * search box.
 *
 * Above ~10 options a plain listbox stops being scannable — picking "TypeScript"
 * out of 175 languages by scrolling is worse than typing three letters. So at
 * more than `SEARCHABLE_THRESHOLD` items this renders Untitled UI's searchable
 * Select.ComboBox and below it the plain Select. Keeping the rule here (rather
 * than at each call site) means every dropdown in the app answers the question
 * the same way.
 */

export { SEARCHABLE_THRESHOLD };

export interface FilterSelectItem {
  id: string;
  label: string;
}

export interface FilterSelectProps {
  label: string;
  items: FilterSelectItem[];
  selectedKey: string;
  onChange: (key: string) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
  className?: string;
  /** Force the search box on or off instead of deciding by item count. */
  searchable?: boolean;
}

export function FilterSelect({
  label,
  items,
  selectedKey,
  onChange,
  placeholder,
  size = 'sm',
  className,
  searchable,
}: FilterSelectProps) {
  const useSearch = searchable ?? items.length > SEARCHABLE_THRESHOLD;

  if (!useSearch) {
    return (
      <Select
        size={size}
        label={label}
        aria-label={label}
        placeholder={placeholder}
        items={items}
        selectedKey={selectedKey}
        onSelectionChange={(key) => onChange(String(key ?? ''))}
        className={className}
      >
        {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
      </Select>
    );
  }

  return (
    <SearchableSelect
      label={label}
      items={items}
      selectedKey={selectedKey}
      onChange={onChange}
      placeholder={placeholder}
      size={size}
      className={className}
    />
  );
}

function SearchableSelect({
  label,
  items,
  selectedKey,
  onChange,
  placeholder,
  size,
  className,
}: Omit<FilterSelectProps, 'searchable'>) {
  const { contains } = useFilter({ sensitivity: 'base' });
  const selectedLabel = items.find((item) => item.id === selectedKey)?.label ?? '';

  /**
   * The input's text is its OWN state, seeded from the selection.
   *
   * It must not be derived as `query || selectedLabel`: deleting the last
   * character makes the query empty, the fallback then puts the selected label
   * straight back, and the field appears impossible to clear or type into.
   */
  const [inputValue, setInputValue] = useState(selectedLabel);

  // Follow the selection when it changes from outside (Reset, or a URL the user
  // navigated to) without fighting the user while they type.
  useEffect(() => {
    setInputValue(selectedLabel);
  }, [selectedLabel]);

  const filtered = useMemo(
    () => narrowItems(items, inputValue, selectedLabel, contains),
    [items, inputValue, selectedLabel, contains],
  );

  return (
    <Select.ComboBox
      size={size}
      label={label}
      aria-label={label}
      placeholder={placeholder ?? 'Search…'}
      // The ⌘K hint belongs to a global search field, not to a filter.
      shortcut={false}
      // Keep the popover open on a no-match query so the user can correct a
      // typo instead of having the list vanish from under them.
      allowsEmptyCollection
      items={filtered}
      selectedKey={selectedKey}
      onSelectionChange={(key) => {
        const next = String(key ?? '');
        setInputValue(items.find((item) => item.id === next)?.label ?? '');
        onChange(next);
      }}
      inputValue={inputValue}
      onInputChange={setInputValue}
      className={className}
    >
      {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
    </Select.ComboBox>
  );
}

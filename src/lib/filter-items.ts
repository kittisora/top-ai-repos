/**
 * The rules behind the filter dropdowns, kept pure so they can be unit tested.
 *
 * The interactive part of a combobox is exactly where an untested off-by-one
 * turns into "I can't type in the box" — which is what happened when the input
 * value was derived with a fallback instead of held as its own state.
 */

/**
 * Above this many options a plain listbox stops being scannable, so the dropdown
 * grows a search box. Picking "TypeScript" out of 175 languages by scrolling is
 * worse than typing three letters.
 */
export const SEARCHABLE_THRESHOLD = 10;

/**
 * Which options a typed query should leave visible.
 *
 * An empty query shows everything — clearing the field should reveal the full
 * list, not an empty one. A query that still equals the selected option's label
 * also shows everything: react-aria rewrites the input back to the selected
 * label on blur, and treating that as a search would leave the list narrowed to
 * a single row the next time the popover opens.
 */
export function narrowItems<T extends { label: string }>(
  items: readonly T[],
  query: string,
  selectedLabel: string,
  matches: (label: string, query: string) => boolean,
): T[] {
  const term = query.trim();
  if (!term || term === selectedLabel) return [...items];
  return items.filter((item) => matches(item.label, term));
}

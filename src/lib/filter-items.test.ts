import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { narrowItems, SEARCHABLE_THRESHOLD } from './filter-items.ts';

/** Stand-in for react-aria's locale-aware `contains` from useFilter. */
const contains = (label: string, query: string) =>
  label.toLowerCase().includes(query.toLowerCase());

const COUNTRIES = [
  { id: '', label: 'Everywhere' },
  { id: 'United States', label: 'United States (186)' },
  { id: 'Germany', label: 'Germany (69)' },
  { id: 'United Kingdom', label: 'United Kingdom (53)' },
  { id: 'France', label: 'France (40)' },
  { id: 'South Korea', label: 'South Korea (9)' },
];

describe('narrowItems', () => {
  it('narrows to matching options as the user types', () => {
    const result = narrowItems(COUNTRIES, 'ger', 'Everywhere', contains);
    assert.deepEqual(
      result.map((item) => item.id),
      ['Germany'],
    );
  });

  it('matches case-insensitively', () => {
    assert.equal(narrowItems(COUNTRIES, 'FRANCE', 'Everywhere', contains).length, 1);
    assert.equal(narrowItems(COUNTRIES, 'france', 'Everywhere', contains).length, 1);
  });

  it('matches on a substring, not just a prefix', () => {
    const result = narrowItems(COUNTRIES, 'kingdom', 'Everywhere', contains);
    assert.deepEqual(
      result.map((item) => item.id),
      ['United Kingdom'],
    );
  });

  /**
   * The reported bug: clearing the field snapped straight back to "Everywhere".
   * An empty query must reveal the FULL list so the box can be typed into.
   */
  it('shows every option when the query is cleared', () => {
    assert.equal(narrowItems(COUNTRIES, '', 'Everywhere', contains).length, COUNTRIES.length);
    assert.equal(narrowItems(COUNTRIES, '   ', 'Everywhere', contains).length, COUNTRIES.length);
  });

  it('shows every option when the text still equals the selected label', () => {
    // react-aria rewrites the input back to the selected label on blur; treating
    // that as a search would leave the list stuck at one row.
    const result = narrowItems(COUNTRIES, 'Germany (69)', 'Germany (69)', contains);
    assert.equal(result.length, COUNTRIES.length);
  });

  it('filters normally once the text differs from the selection', () => {
    const result = narrowItems(COUNTRIES, 'united', 'Germany (69)', contains);
    assert.deepEqual(
      result.map((item) => item.id),
      ['United States', 'United Kingdom'],
    );
  });

  it('returns an empty list for a genuine no-match', () => {
    assert.deepEqual(narrowItems(COUNTRIES, 'zzz', 'Everywhere', contains), []);
  });

  it('never mutates the input list', () => {
    const before = [...COUNTRIES];
    narrowItems(COUNTRIES, '', 'Everywhere', contains).push({ id: 'x', label: 'x' });
    assert.deepEqual(COUNTRIES, before);
  });
});

describe('searchable threshold', () => {
  it('is the documented 10', () => {
    assert.equal(SEARCHABLE_THRESHOLD, 10);
  });
});

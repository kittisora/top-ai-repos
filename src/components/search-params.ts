/**
 * URL-query plumbing shared by the pages and the navigation components.
 *
 * Every filter on this site lives in the query string — no client state store,
 * no context. That is what keeps the explorer a server component and every
 * result view linkable, and it means these helpers are the only place that
 * knows how a filter becomes a URL.
 */

/** The shape Next.js hands a page after `await searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * Repeated keys (`?a=1&a=2`) arrive as arrays. None of our filters are
 * multi-valued, so the first value wins rather than the request 400-ing.
 * Blank values are dropped: `?language=` is what a cleared <select> submits and
 * it means "no filter", not "language equals empty string".
 */
export function toQueryRecord(params: RawSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first !== 'string') continue;
    const trimmed = first.trim();
    if (trimmed === '') continue;
    out[key] = trimmed;
  }
  return out;
}

export type HrefPatch = Record<string, string | number | boolean | undefined | null>;

/**
 * Build a link that keeps the current filters and changes only what is patched.
 * A `null`/`undefined`/`''` patch value removes the key, which is how "clear
 * this filter" links are expressed.
 */
export function buildHref(
  pathname: string,
  current: Record<string, string>,
  patch: HrefPatch = {},
): string {
  const next = new URLSearchParams(current);

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === '' || value === false) {
      next.delete(key);
    } else {
      next.set(key, String(value));
    }
  }

  // Sorted so that two links describing the same view are the same string —
  // otherwise the router treats them as different routes and prefetches twice.
  next.sort();

  const qs = next.toString();
  return qs === '' ? pathname : `${pathname}?${qs}`;
}

/**
 * Any change to a filter invalidates the current page number: staying on page 7
 * of a result set that just shrank to two pages shows an empty screen.
 */
export function buildFilterHref(
  pathname: string,
  current: Record<string, string>,
  patch: HrefPatch,
): string {
  return buildHref(pathname, current, { ...patch, page: undefined });
}

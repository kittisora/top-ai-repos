/**
 * Every domain we own that points at this site.
 *
 * Exactly ONE of these is the canonical home — whichever NEXT_PUBLIC_SITE_URL
 * resolves to. proxy.ts 301-redirects the others (and any www. variant) to it,
 * and the canonical/OG/sitemap URLs all use it, so Google consolidates ranking
 * onto the single canonical domain instead of splitting it three ways.
 *
 * Order here does not matter; the canonical is derived from the env URL, not
 * from position. Add any further domains you buy.
 */
export const OWNED_DOMAINS = [
  'topairepos.com', // canonical (NEXT_PUBLIC_SITE_URL)
  'aireporank.com',
  'airepolist.com',
] as const;

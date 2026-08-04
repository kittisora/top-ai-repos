import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `worker` over `items` with at most `limit` in flight.
 *
 * Results come back in input order. A rejected worker rejects the whole call,
 * so callers that need partial success should catch inside the worker - the
 * ingestion pipeline does exactly that, since one dead repo must not abort a
 * 2,000-repo sync.
 *
 * This replaces p-limit: it is 20 lines, has no ESM/CJS interop surprises, and
 * we need the ordering guarantee anyway.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });

  await Promise.all(runners);
  return results;
}

/** Split into fixed-size chunks - used for both API batching and bulk inserts. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 1234 -> "1.2k", 1234567 -> "1.2M" */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014';
  if (Math.abs(value) < 1000) return String(value);
  if (Math.abs(value) < 1_000_000) {
    const k = value / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`;
  }
  const m = value / 1_000_000;
  return `${m >= 10 ? Math.round(m) : m.toFixed(1)}M`;
}

const integerFormatter = new Intl.NumberFormat('en-US');

/** 1234 -> "1,234" */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014';
  return integerFormatter.format(value);
}

/** Signed delta for the growth columns: 428 -> "+428", 0 -> "—" */
export function formatDelta(value: number | null | undefined): string {
  if (!value) return '\u2014';
  return `${value > 0 ? '+' : ''}${formatCompact(value)}`;
}

const RELATIVE_UNITS: [limitSeconds: number, seconds: number, unit: Intl.RelativeTimeFormatUnit][] =
  [
    [60, 1, 'second'],
    [3600, 60, 'minute'],
    [86400, 3600, 'hour'],
    [2592000, 86400, 'day'],
    [31536000, 2592000, 'month'],
    [Infinity, 31536000, 'year'],
  ];

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatRelativeTime(
  value: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return 'unknown';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return 'unknown';

  const deltaSeconds = (date.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(deltaSeconds);

  for (const [limit, divisor, unit] of RELATIVE_UNITS) {
    if (abs < limit) return rtf.format(Math.round(deltaSeconds / divisor), unit);
  }
  return 'unknown';
}

/**
 * Ask GitHub for an avatar at the size we actually paint it.
 *
 * `avatar_url` from the API carries no size parameter, so GitHub serves the
 * original upload. Measured against the top repos in this index: 19–24 KB each,
 * to fill a 28px square. Adding `?s=N` makes GitHub's own CDN do the resize and
 * the same images come back at 1.4–2.6 KB — roughly 12x smaller, at no cost to us.
 *
 * It matters because avatars come in listings, not ones and twos: 50 on
 * /contributors, 24 per page of /repos, 32 on the homepage, 20 on a detail page.
 * At full size that is ~1.1 MB of images on the contributors table alone.
 *
 * `px` is the DEVICE pixel size — pass 2x the CSS size so it stays sharp on
 * retina. This is also why the <Image> components keep `unoptimized`: GitHub's
 * CDN already does the resizing, so routing these through Next's optimiser would
 * only spend our own CPU and disk cache to arrive at the same bytes.
 *
 * Non-GitHub hosts are returned untouched. Owners and contributors are always
 * GitHub-hosted today, but a future import from elsewhere must not silently
 * acquire a meaningless query parameter.
 */
export function githubAvatarUrl(url: string, px: number): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (parsed.hostname !== 'avatars.githubusercontent.com') return url;

  // `set` rather than `append`: these URLs already carry `?v=4` and sometimes a
  // `u=` cache-buster, and a second `s=` would be ignored in favour of the first.
  parsed.searchParams.set('s', String(Math.round(px)));
  return parsed.toString();
}

/** ISO date (YYYY-MM-DD) in UTC - the key format for repository_metrics. */
export function isoDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function daysAgoIso(days: number, from: Date = new Date()): string {
  return isoDate(new Date(from.getTime() - days * 86_400_000));
}

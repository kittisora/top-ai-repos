import 'dotenv/config';

import { snapshot, withRun } from '@/lib/ingest';
import { arg, main } from './cli';

/**
 * Record today's metrics and recompute the star deltas.
 *
 *   npm run snapshot
 *   npm run snapshot -- --date=2026-07-24    re-run a specific UTC day
 *
 * Safe to run repeatedly: the day's row is updated in place, never duplicated.
 * Skipping a day, on the other hand, loses that day's growth data permanently —
 * GitHub publishes no history to backfill from.
 */
await main(async () => {
  await withRun('snapshot', ({ log }) => snapshot({ log, date: arg('date') }));
});

import 'dotenv/config';

import { score, withRun } from '@/lib/ingest';
import { main } from './cli';

/**
 * Recompute trend and quality for every active repository.
 *
 * No network calls — pure recomputation from stored data, so it is cheap and
 * always safe to re-run. It must run AFTER snapshot, which is what produces
 * the starsDay/starsWeek inputs the trend model reads.
 */
await main(async () => {
  // A single frozen clock for the whole table: scoring 15,000 repos takes long
  // enough that a drifting `new Date()` would put the last rows in a different
  // recency bucket than the first.
  const now = new Date();
  await withRun('score', ({ log }) => score({ log, now }));
});

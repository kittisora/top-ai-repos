import 'dotenv/config';

import { refreshMetrics, withRun } from '@/lib/ingest';
import { main, numArg } from './cli';

/**
 * Refresh stars / forks / open issues / watchers for EVERY active repository.
 *
 *   npm run metrics                  the whole table, ~491 GraphQL queries
 *   npm run metrics -- --limit=500   a bounded slice, for a smoke test
 *
 * Cheap and always safe to re-run: it reads four counters, writes only the rows
 * whose values actually moved, and touches neither last_synced_at nor a repo's
 * status — so it cannot disturb sync's rotation or its lifecycle decisions.
 *
 * Running it on its own refreshes the table but records no history. `npm run
 * snapshot` is what writes the day's row, which is why the pipeline runs this
 * immediately before it.
 */
await main(async () => {
  // 0 means "every active repo", which is the point of the stage.
  await withRun('metrics', ({ log }) => refreshMetrics({ log, limit: numArg('limit', 0) }));
});

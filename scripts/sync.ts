import 'dotenv/config';

import { sync, withRun } from '@/lib/ingest';
import { flag, main, numArg } from './cli';

/**
 * Refresh metadata for repositories we already know about.
 *
 *   npm run sync                        oldest-synced 1,000 repos
 *   npm run sync -- --limit=5000
 *   npm run sync -- --no-readme         cheap pass: skips README blobs, which
 *                                       are the #1 cause of GraphQL timeouts
 */
await main(async () => {
  await withRun('sync', ({ log }) =>
    sync({
      log,
      limit: numArg('limit', 1_000),
      includeReadme: !flag('no-readme'),
      contributorLimit: numArg('contributors', 200),
      readmeLimit: numArg('readmes', 200),
    }),
  );
});

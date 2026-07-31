import 'dotenv/config';

import {
  backfillContributors,
  backfillOwnerCountries,
  classify,
  discover,
  enrichContributorProfiles,
  score,
  snapshot,
  sync,
  withRun,
} from '@/lib/ingest';
import { env } from '@/lib/env';
import { daysAgoIso } from '@/lib/utils';
import { flag, main, numArg } from './cli';

/**
 * THE DAILY COMMAND. Run this once a day and the site stays current:
 *
 *   npm run ingest
 *
 * Useful variants:
 *   npm run ingest -- --days=2            only discover repos created recently (cheap)
 *   npm run ingest -- --skip-discover     refresh what we have, find nothing new
 *   npm run ingest -- --sync-limit=3000   push harder on metadata refresh
 *   npm run ingest -- --profiles=0        skip the contributor-profile pass
 *
 * Stage order is deliberate:
 *
 *   discover      new repos enter the index
 *   sync          refresh stars/readme/releases/owner location for known repos
 *   snapshot      TODAY'S METRICS — runs early on purpose, see below
 *   countries     owner_location -> owner_country (needs sync; no API calls)
 *   contributors  top contributors per repo -> people + link rows
 *   profiles      one /users call each for the highest-ranked people (country)
 *   classify      categories, from the README sync just fetched
 *   score         last: it consumes the snapshot deltas and contributor data
 *
 * `snapshot` sits third rather than last because it is the ONE stage whose data
 * cannot be recovered later — a missed day is gone forever. The stages after it
 * make thousands of GitHub calls and can sit in a rate-limit pause for a long
 * time; if the process died there, a late snapshot would have been lost with it.
 * The cost of running it early is that today's row carries yesterday's
 * contributor counts, which does not distort growth at all: the weekly delta
 * compares two snapshots that are lagged identically.
 *
 * A stage that fails does NOT stop the ones after it — a GitHub outage during
 * discovery must not also cost the day's snapshot. Every run is recorded in
 * `sync_runs`, and the process still exits non-zero so a scheduler notices.
 */

interface Stage {
  name: string;
  skip: boolean;
  run: (log: (message: string) => void) => Promise<Record<string, number | string>>;
}

await main(async () => {
  const days = numArg('days', 0);
  const profiles = numArg('profiles', 1_000);
  const contributorLimit = numArg('contributor-limit', 500);

  const stages: Stage[] = [
    {
      name: 'discover',
      skip: flag('skip-discover'),
      run: (log) =>
        discover({
          log,
          createdFrom: days > 0 ? daysAgoIso(days) : undefined,
          maxSearches: numArg('max-searches', 400),
        }),
    },
    {
      name: 'sync',
      skip: flag('skip-sync'),
      run: (log) => sync({ log, limit: numArg('sync-limit', 1_500) }),
    },
    {
      // Irrecoverable if missed — see the note above on why this is not last.
      name: 'snapshot',
      skip: flag('skip-snapshot'),
      run: (log) => snapshot({ log }),
    },
    {
      name: 'countries',
      skip: flag('skip-countries'),
      run: (log) => backfillOwnerCountries({ log }),
    },
    {
      name: 'contributors',
      skip: flag('skip-contributors') || contributorLimit <= 0,
      run: (log) =>
        backfillContributors({
          log,
          minStars: numArg('min-stars', 500),
          limit: contributorLimit,
        }),
    },
    {
      name: 'profiles',
      skip: flag('skip-profiles') || profiles <= 0,
      run: (log) => enrichContributorProfiles({ log, limit: profiles }),
    },
    {
      name: 'classify',
      skip: flag('skip-classify'),
      run: (log) => classify({ log, limit: numArg('classify-limit', 5_000) }),
    },
    {
      name: 'score',
      skip: flag('skip-score'),
      run: (log) => score({ log, now: new Date() }),
    },
  ];

  const failures: string[] = [];

  for (const stage of stages) {
    if (stage.skip) {
      console.log(`--- ${stage.name}: skipped`);
      continue;
    }
    console.log(`--- ${stage.name}`);
    try {
      await withRun(stage.name, ({ log }) => stage.run(log));
    } catch (error) {
      failures.push(stage.name);
      console.error(
        `stage ${stage.name} failed:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (failures.length > 0) {
    // Thrown rather than exited here so `main` prints it and returns 1.
    throw new Error(`${failures.length} stage(s) failed: ${failures.join(', ')}`);
  }

  console.log(`ingest complete for ${env.siteName}`);
});

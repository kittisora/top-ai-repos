import 'dotenv/config';

import {
  backfillContributors,
  backfillOwnerCountries,
  classify,
  discover,
  enrichContributorProfiles,
  refreshMetrics,
  score,
  snapshot,
  sync,
  withRun,
} from '@/lib/ingest';
import { env } from '@/lib/env';
import { errorFacts } from '@/lib/errors';
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
 *   npm run ingest -- --metrics-limit=500 bound the full-table counter sweep
 *   npm run ingest -- --skip-metrics      turn that sweep off entirely
 *   npm run ingest -- --profiles=0        skip the contributor-profile pass
 *
 * Note the asymmetry: `--profiles=0` and `--contributor-limit=0` DISABLE their
 * stages, but `--metrics-limit=0` is the default and means "every active repo",
 * because a bounded counter sweep is the special case rather than the norm.
 * `--skip-metrics` is the off switch.
 *
 * Stage order is deliberate:
 *
 *   discover      new repos enter the index
 *   sync          refresh stars/readme/releases/owner location for known repos
 *   metrics       stars/forks/issues/watchers for EVERY repo — see below
 *   snapshot      TODAY'S METRICS — runs early on purpose, see below
 *   countries     owner_location -> owner_country (needs sync; no API calls)
 *   contributors  top contributors per repo -> people + link rows
 *   profiles      one /users call each for the highest-ranked people (country)
 *   classify      categories, from the README sync just fetched
 *   score         last: it consumes the snapshot deltas and contributor data
 *
 * `metrics` sits between `sync` and `snapshot` because sync cannot keep the star
 * counts current on its own. Its deep enrichment only affords ~1,500 repos a
 * run, so with 24.5k active repos a full rotation takes eight days, and
 * `snapshot` records whatever star count happens to be on the row — which meant
 * the stored history moved in one jump a week rather than daily. The metrics
 * sweep re-reads only the four volatile counters over a dedicated lightweight
 * GraphQL fragment (~491 queries and ~491 points for the whole table, ~16
 * minutes measured), and therefore covers EVERY repo every run. It has to run
 * after `sync` so it overwrites rather than is overwritten, and immediately
 * before `snapshot` so the values being recorded are minutes old instead of
 * days.
 *
 * `snapshot` sits fourth rather than last because it is the ONE stage whose data
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
      // Cheap, full-table, and pointless anywhere but directly ahead of
      // snapshot — that adjacency is the whole reason it exists.
      name: 'metrics',
      skip: flag('skip-metrics'),
      run: (log) => refreshMetrics({ log, limit: numArg('metrics-limit', 0) }),
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
      // Not `error.message`: for a drizzle query failure that is the entire SQL
      // statement, and the reason is one level down in `error.cause`.
      console.error(`stage ${stage.name} failed:`);
      console.error(errorFacts(error).join('\n'));
    }
  }

  if (failures.length > 0) {
    // Thrown rather than exited here so `main` prints it and returns 1.
    throw new Error(`${failures.length} stage(s) failed: ${failures.join(', ')}`);
  }

  console.log(`ingest complete for ${env.siteName}`);
});

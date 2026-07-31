import 'dotenv/config';

import {
  backfillContributors,
  backfillOwnerCountries,
  enrichContributorProfiles,
  score,
  withRun,
} from '@/lib/ingest';
import { flag, main, numArg } from './cli';

/**
 * Populate the people behind the repositories, then re-score.
 *
 *   npm run contributors                      repos >= 500 stars with no contributor rows
 *   npm run contributors -- --min-stars=1000
 *   npm run contributors -- --limit=2000 --profiles=1000
 *   npm run contributors -- --skip-people     only enrich profiles / countries
 *
 * Stages, in order:
 *   1. countries  owner_location -> owner_country (no API calls, whole table)
 *   2. people     top contributors per repo -> contributors + link rows
 *   3. profiles   one /users call each for the highest-ranked people; this is
 *                 what fills contributors.country, so the geography view needs it
 *   4. score      contributor count and bus-factor share feed the quality model
 *
 * Stages 2 and 3 cost REST calls (1-2 and 1 per item), so each is bounded by its
 * own limit against the 5,000/hour core budget; the client's rate limiter pauses
 * and resumes on its own if the budget runs out mid-run.
 */
await main(async () => {
  await withRun('countries', ({ log }) => backfillOwnerCountries({ log }));

  if (!flag('skip-people')) {
    await withRun('contributors', ({ log }) =>
      backfillContributors({
        log,
        minStars: numArg('min-stars', 500),
        limit: numArg('limit', 4_000),
        force: flag('force'),
      }),
    );
  }

  if (!flag('skip-profiles')) {
    await withRun('profiles', ({ log }) =>
      enrichContributorProfiles({ log, limit: numArg('profiles', 2_000) }),
    );
  }

  await withRun('score', ({ log }) => score({ now: new Date(), log }));
});

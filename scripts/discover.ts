import 'dotenv/config';

import { discover, withRun } from '@/lib/ingest';
import { daysAgoIso } from '@/lib/utils';
import { flag, listArg, main, numArg } from './cli';

/**
 * Find new AI repositories.
 *
 *   npm run discover                       full sweep: topics + phrases (~25-40 min)
 *   npm run discover -- --days=7           only repos created in the last week
 *   npm run discover -- --topics=mcp,rag   restrict to specific topic slugs
 *   npm run discover -- --phrases="ai agent,llm"
 *   npm run discover -- --no-topics        phrases only
 *   npm run discover -- --no-phrases       topics only (the old behaviour)
 *   npm run discover -- --max-searches=100
 *
 * Two complementary modes, and the second is not optional in practice: topic
 * search can only find repositories whose authors tagged them, and a measured
 * sample of popular AI projects put ~67% out of its reach — including
 * anthropics/claude-code and openai/codex, which carry no topics at all. Phrase
 * search matches the name and description instead, so it reaches them.
 *
 * Search is hard-capped at 30 requests/minute and the client spaces them 2.1s
 * apart, so wall-clock time is entirely a function of --max-searches.
 */
await main(async () => {
  const days = numArg('days', 0);

  await withRun('discover', ({ log }) =>
    discover({
      log,
      topics: flag('no-topics') ? [] : listArg('topics'),
      phrases: flag('no-phrases') ? [] : listArg('phrases'),
      createdFrom: days > 0 ? daysAgoIso(days) : undefined,
      maxSearches: numArg('max-searches', 1_200),
      limit: numArg('limit', 0) || undefined,
    }),
  );
});

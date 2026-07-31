import 'dotenv/config';

import { classify, withRun } from '@/lib/ingest';
import { env } from '@/lib/env';
import { flag, main, numArg } from './cli';

/**
 * Assign taxonomy categories.
 *
 *   npm run classify
 *   npm run classify -- --limit=500
 *   npm run classify -- --force         ignore the input-fingerprint cache
 *
 * Rules run for free on everything. The LLM is only consulted for repos the
 * rules cannot separate, and only when ENABLE_LLM_CLASSIFY=1 with an API key
 * present.
 */
await main(async () => {
  if (!env.enableLlmClassify) {
    console.log('LLM classification disabled (ENABLE_LLM_CLASSIFY / OPENAI_API_KEY) — rules only');
  }

  await withRun('classify', ({ log }) =>
    classify({
      log,
      limit: numArg('limit', 5_000),
      concurrency: numArg('concurrency', 8),
      force: flag('force'),
    }),
  );
});

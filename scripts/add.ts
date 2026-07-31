import 'dotenv/config';

import { classify, score } from '@/lib/ingest';
import { upsertDiscovered } from '@/lib/ingest/discover';
import { github } from '@/lib/github';
import type { SearchRepoItem } from '@/lib/github';
import { normalizeGitHubRepo } from '@/lib/api/validation';
import { finish } from './cli';

/**
 * Add specific repositories by name — the escape hatch for topic-based
 * discovery's blind spot.
 *
 * Discovery only finds repos that self-tag with one of our curated topic
 * slugs. A hugely popular repo that tags itself `ai`/`assistant` (too broad to
 * seed) or nothing at all is invisible to it — e.g. openclaw/openclaw, 384k
 * stars, was missing for exactly this reason. This is also the processor a
 * submissions queue would call once a submission is approved.
 *
 *   npm run add -- openclaw/openclaw
 *   npm run add -- https://github.com/owner/name owner2/name2
 *
 * Added repos are upserted with full REST metadata (so they display at once),
 * then classified and scored. They carry a null last_synced_at, so the next
 * sync pass enriches them (README, releases, contributors) ahead of everything
 * else.
 */

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));

async function run(): Promise<void> {
  if (positional.length === 0) {
    console.error('usage: npm run add -- <owner/name | github url> [more…]');
    return finish(1);
  }

  // Normalise and dedupe before spending any API calls.
  const names = new Set<string>();
  for (const raw of positional) {
    const normalized = normalizeGitHubRepo(raw);
    if (!normalized.ok) {
      console.warn(`skip "${raw}": ${normalized.error}`);
      continue;
    }
    names.add(normalized.value.fullName);
  }

  if (names.size === 0) {
    console.error('nothing valid to add');
    return finish(1);
  }

  const items: SearchRepoItem[] = [];
  for (const fullName of names) {
    try {
      const result = await github.getRepoByFullName(fullName);
      if (result.status === 'gone') {
        console.warn(`skip ${fullName}: not found (deleted, renamed or private)`);
        continue;
      }
      // A fresh add sends no ETag, so 'not-modified' cannot occur here; guard
      // anyway so a future caller passing an ETag doesn't silently drop it.
      if (result.status === 'not-modified') continue;
      items.push(result.repo);
      console.log(`fetched ${result.repo.full_name} — ★${result.repo.stargazers_count}`);
    } catch (error) {
      console.warn(`skip ${fullName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (items.length === 0) {
    console.error('no repositories could be fetched');
    return finish(1);
  }

  const { inserted, updated } = await upsertDiscovered(items, 'manual:add');
  console.log(`upserted ${items.length} repo(s): ${inserted} new, ${updated} updated`);

  // Categorise and score so the additions are fully live immediately. Both are
  // cache-aware / whole-table but fast; the new repos sort first (never
  // classified, so they lead the queue).
  console.log('classifying…');
  await classify({ log: (m) => console.log(`  ${m}`) });
  console.log('scoring…');
  await score({ now: new Date(), log: (m) => console.log(`  ${m}`) });

  console.log(
    `done — added repos will get READMEs/releases/contributors on the next sync ` +
      `(they lead the queue). Run: npm run sync`,
  );
}

await run();
await finish(0);

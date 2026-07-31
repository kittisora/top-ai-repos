import 'dotenv/config';

import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { flag, main } from './cli';

/**
 * Reclaim disk space: `npm run db:vacuum`
 *
 * Autovacuum keeps the database CORRECT but never makes the files smaller — it
 * marks dead space reusable in place. The sync job rewrites the same rows
 * constantly (millions of updates), and large columns like the README excerpt
 * live in out-of-line TOAST storage, so the file keeps the high-water mark of
 * every rewrite. On this project that had grown to ~185 MB of dead weight, and
 * one pass took the whole database from 361 MB to 175 MB.
 *
 * VACUUM FULL rewrites each table compactly, which means:
 *   - it takes an EXCLUSIVE lock, so the table is unreadable while it runs
 *     (~25s for the biggest table here) — run it when the site is quiet;
 *   - it needs temporary room for the new copy, so it is not something to run
 *     when the database is already at its size limit.
 *
 * Run it every few months, or whenever the reported size looks larger than the
 * data should be. `--dry-run` just reports sizes and changes nothing.
 */

/** Biggest first, so the largest win happens even if the run is interrupted. */
const TABLES = [
  'repositories',
  'repository_metrics',
  'contributors',
  'repository_categories',
  'repository_contributors',
  'discovery_shards',
  'sync_runs',
] as const;

async function databaseSize(): Promise<string> {
  const result = await db.execute<{ sz: string }>(
    sql`select pg_size_pretty(pg_database_size(current_database())) sz`,
  );
  return result.rows[0]?.sz ?? 'unknown';
}

async function tableSize(table: string): Promise<string> {
  const result = await db.execute<{ sz: string }>(
    sql`select pg_size_pretty(pg_total_relation_size(${table}::regclass)) sz`,
  );
  return result.rows[0]?.sz ?? 'unknown';
}

await main(async () => {
  const dryRun = flag('dry-run');

  console.log(`database before: ${await databaseSize()}`);
  if (dryRun) console.log('(dry run — nothing will be rewritten)\n');

  for (const table of TABLES) {
    const before = await tableSize(table);

    if (dryRun) {
      console.log(`  ${table.padEnd(24)} ${before.padStart(9)}`);
      continue;
    }

    const startedAt = Date.now();
    // sql.raw because a table name cannot be a bind parameter, and VACUUM
    // cannot run inside a transaction block — db.execute issues it directly.
    await db.execute(sql.raw(`vacuum (full, analyze) ${table}`));
    const seconds = Math.round((Date.now() - startedAt) / 1000);

    console.log(`  ${table.padEnd(24)} ${before.padStart(9)} -> ${await tableSize(table)}  (${seconds}s)`);
  }

  console.log(`\ndatabase after: ${await databaseSize()}`);
});

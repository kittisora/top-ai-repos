import 'dotenv/config';

import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { main } from './cli';

/**
 * Pre/post-migration baseline.
 *
 *   npm run db:info
 *
 * Prints the server version, the extensions the schema depends on, per-table row
 * counts and the live-vs-on-disk size split. Run it against the OLD database
 * before a migration and the NEW one after: if every row count matches and the
 * extensions are present, the move is good. Row counts are the only check that
 * actually proves the data arrived — a restore can succeed loudly and still have
 * skipped a table.
 *
 * Deliberately read-only, and cheap: the counts are exact `count(*)` scans but
 * they return one integer each, so this costs almost nothing in egress even
 * against a hosted database that bills for it.
 */

const TABLES = [
  'repositories',
  'repository_metrics',
  'categories',
  'repository_categories',
  'contributors',
  'repository_contributors',
  'discovery_shards',
  'submissions',
  'sync_runs',
] as const;

/** The schema cannot be restored without these; see drizzle/0002. */
const REQUIRED_EXTENSIONS = ['pg_trgm'] as const;

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

await main(async () => {
  {
    const version = await db.execute<{ version: string }>(sql`select version()`);
    console.log(`server   : ${version.rows[0]?.version ?? 'unknown'}`);

    const dbSize = await db.execute<{ name: string; pretty: string; bytes: string }>(sql`
      select current_database() as name,
             pg_size_pretty(pg_database_size(current_database())) as pretty,
             pg_database_size(current_database())::text as bytes
    `);
    const size = dbSize.rows[0];
    console.log(`database : ${size?.name} — ${size?.pretty} on disk`);

    const user = await db.execute<{ me: string; superuser: boolean; bypassrls: boolean }>(sql`
      select current_user as me,
             (select usesuper from pg_user where usename = current_user) as superuser,
             (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls
    `);
    const me = user.rows[0];
    console.log(
      `role     : ${me?.me} (superuser=${me?.superuser}, bypassrls=${me?.bypassrls})`,
    );

    console.log('\nextensions the schema needs:');
    for (const name of REQUIRED_EXTENSIONS) {
      const found = await db.execute<{ extversion: string }>(
        sql`select extversion from pg_extension where extname = ${name}`,
      );
      const version = found.rows[0]?.extversion;
      console.log(`  ${pad(name, 12)} ${version ? `present (${version})` : 'MISSING'}`);
    }

    /**
     * RLS state is reported because it is the single most likely way a
     * self-hosted restore breaks: these tables have RLS enabled and NO policies,
     * which is default-deny. That is invisible on a connection whose role has
     * BYPASSRLS (Supabase's `postgres`) and silently returns zero rows on one
     * that does not.
     */
    console.log('\ntable                        rows      rls  policies');
    let total = 0;
    for (const table of TABLES) {
      const counted = await db.execute<{ n: string }>(
        sql`select count(*)::text as n from ${sql.identifier(table)}`,
      );
      const n = Number(counted.rows[0]?.n ?? 0);
      total += n;

      const meta = await db.execute<{ rls: boolean; policies: string }>(sql`
        select c.relrowsecurity as rls,
               (select count(*)::text from pg_policies p
                 where p.schemaname = 'public' and p.tablename = ${table}) as policies
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = ${table}
      `);
      const row = meta.rows[0];

      console.log(
        `  ${pad(table, 26)} ${padLeft(n.toLocaleString(), 9)}  ${pad(
          row?.rls ? 'on' : 'off',
          4,
        )} ${row?.policies ?? '?'}`,
      );
    }
    console.log(`  ${pad('TOTAL', 26)} ${padLeft(total.toLocaleString(), 9)}`);

    if (me?.bypassrls === false) {
      console.log(
        '\nWARNING: this role does NOT have BYPASSRLS. Every table above with ' +
          'rls=on and 0 policies will return zero rows for it, with no error.',
      );
    }
  }
});

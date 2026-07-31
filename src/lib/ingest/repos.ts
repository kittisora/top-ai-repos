/**
 * Shared repository-write helpers.
 *
 * Both discovery and sync write into `repositories`, and both hit the same two
 * footguns: GitHub timestamps that are sometimes empty strings, and the
 * `repositories_full_name_uq` index colliding when a repo gets renamed into a
 * name another row already holds.
 */

import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { chunk } from '@/lib/utils';

/**
 * Postgres caps a statement at 65,535 bind parameters and Drizzle does not
 * chunk for you. The widest repository insert binds ~28 columns, so 500 rows
 * (~14,000 params) leaves a wide margin and keeps single statements small
 * enough that one bad row does not roll back a whole run's worth of work.
 */
export const REPO_INSERT_CHUNK = 500;

/**
 * GitHub's REST parser substitutes '' for missing timestamps (empty repos have
 * a null `pushed_at`), and `new Date('')` is an Invalid Date that Postgres
 * rejects with a driver-level error rather than a per-row failure.
 */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Free up `full_name` values that are about to be claimed by a different
 * `github_id`.
 *
 * This happens whenever a repo is renamed and some other repo (often the
 * original owner's redirect placeholder, occasionally a squatter) already
 * occupies the new name in our table. Without this the whole upsert chunk dies
 * on a unique-violation and takes 499 innocent rows with it.
 *
 * The loser is tombstoned rather than deleted: its id may be referenced by
 * metrics, categories and contributor rows, and keeping it as 'rejected' also
 * stops discovery from re-adding it every week.
 */
export async function releaseConflictingFullNames(
  rows: readonly { fullName: string; githubId: number }[],
): Promise<number> {
  if (rows.length === 0) return 0;

  let released = 0;

  for (const batch of chunk(rows, REPO_INSERT_CHUNK)) {
    // Every VALUES element is cast explicitly: Postgres cannot infer a type for
    // a bare parameter inside VALUES and answers "could not determine data type
    // of parameter $1" instead.
    const values = sql.join(
      batch.map((row) => sql`(${row.fullName}::text, ${row.githubId}::bigint)`),
      sql`, `,
    );

    const result = await db.execute(sql`
      update repositories r
      set full_name = r.full_name || '#superseded-' || r.id,
          status = 'rejected'
      from (values ${values}) as incoming(full_name, github_id)
      where r.full_name = incoming.full_name
        and r.github_id <> incoming.github_id
    `);

    released += result.rowCount ?? 0;
  }

  return released;
}

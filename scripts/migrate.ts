import 'dotenv/config';

/**
 * Programmatic migration runner.
 *
 * Uses its own single-connection pool rather than the shared one from @/db:
 * migrations take an advisory lock and run DDL, and both behave badly when the
 * driver can hand successive statements to different backends.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { env } from '@/lib/env';

const pool = new Pool({ connectionString: env.databaseUrl, max: 1 });
let failed = false;

try {
  const db = drizzle(pool);
  console.log('applying migrations from ./drizzle …');
  // The config argument is REQUIRED — `migrate(db)` does not typecheck and the
  // folder is not inferred from drizzle.config.ts at runtime.
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('migrations applied');
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
} finally {
  await pool.end();
}

process.exit(failed ? 1 : 0);

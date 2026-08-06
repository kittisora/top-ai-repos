import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from '@/lib/env';
import * as schema from './schema';

/**
 * The database client.
 *
 * `pg` is the one driver that works everywhere we need it: the long-running
 * ingestion worker (real interactive transactions, persistent TCP) and the
 * Next.js Node runtime, against both Neon and Supabase. The Neon HTTP driver
 * would throw at runtime on `db.transaction()` and cannot reach Supabase at
 * all.
 *
 * The pool is cached on globalThis because Next.js dev re-evaluates modules on
 * every hot reload; without this you leak a pool per edit until the database
 * refuses new connections.
 */

declare global {
  var __ailistPool: Pool | undefined;
}

function createPool(): Pool {
  return new Pool({
    connectionString: env.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // SSL is configured entirely through the connection string's `sslmode`:
    //   - Neon, and Supabase's DIRECT endpoint, serve publicly-trusted certs —
    //     use `?sslmode=verify-full` for full protection.
    //   - Supabase's POOLER (Supavisor, *.pooler.supabase.com) presents a cert
    //     signed by Supabase's own CA, which is not in Node's trust store, so
    //     `verify-full`/`require` fail with SELF_SIGNED_CERT_IN_CHAIN. Use
    //     `?sslmode=no-verify` there: the link is still TLS-encrypted, only the
    //     CA check is skipped. To keep full verification, download Supabase's CA
    //     and pass it via a `ssl: { ca }` option instead of no-verify.
    // We deliberately do NOT hardcode `rejectUnauthorized: false` here — that
    // would silently disable verification for every provider, including the ones
    // that don't need it.
  });
}

export const pool: Pool = globalThis.__ailistPool ?? createPool();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__ailistPool = pool;
}

// `{ schema }` is mandatory — without it `db.query.*` is undefined at runtime
// while still typechecking cleanly.
export const db = drizzle(pool, { schema, casing: 'snake_case' });

export { schema };
export * from './schema';

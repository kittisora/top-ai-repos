import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and add your Postgres connection string.',
  );
}

export default defineConfig({
  // Must be exactly 'postgresql' — not 'postgres', 'pg' or 'pgsql'.
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    // Use the DIRECT / session connection (port 5432). DDL plus the
    // __drizzle_migrations bookkeeping need a stable session, so a transaction
    // pooler (Supabase 6543, Neon pooled host) will fail here.
    url: process.env.DATABASE_URL,
  },
  // Keeps drizzle-kit out of Supabase's auth/storage/realtime schemas.
  schemaFilter: ['public'],
  verbose: true,
  strict: true,
  // NOTE: no `driver` field. For the postgresql dialect it only accepts
  // 'aws-data-api' | 'pglite' — setting it for ordinary Neon/Supabase breaks.
});

/**
 * Shared plumbing for the CLI entry points.
 *
 * Deliberately tiny: the scripts are meant to be thin, and every line of logic
 * that lives here instead of src/lib/ingest is a line that cannot be tested or
 * reused from the app.
 *
 * NOTE for anyone adding a script: `import 'dotenv/config'` must be the FIRST
 * import in the entry file. ESM evaluates imports in source order, and this
 * module pulls in @/db, whose pool reads DATABASE_URL at module-evaluation
 * time — importing it before dotenv throws "Missing required environment
 * variable DATABASE_URL" before a single line of your script runs.
 */

import { pool } from '@/db';
import { errorFacts } from '@/lib/errors';

const args = process.argv.slice(2);

/** `--name=value` → "value" */
export function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

export function numArg(name: string, fallback: number): number {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `--name` present anywhere in argv */
export function flag(name: string): boolean {
  return args.includes(`--${name}`);
}

/** `--a,b,c` style list */
export function listArg(name: string): string[] | undefined {
  const raw = arg(name);
  if (raw === undefined) return undefined;
  const items = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return items.length > 0 ? items : undefined;
}

/**
 * Close the connection pool and exit.
 *
 * `process.exit` is explicit rather than letting the event loop drain: pg keeps
 * idle sockets warm for 30s, and a CI job that hangs for half a minute after
 * printing "done" looks broken.
 */
export async function finish(code = 0): Promise<never> {
  try {
    await pool.end();
  } catch (error) {
    console.error('failed to close the connection pool:', error);
  }
  process.exit(code);
}

/**
 * Run a script body, report the failure legibly, and always exit cleanly.
 *
 * The cause chain is printed BEFORE the stack. Printing `error.stack` alone —
 * which this used to do — hides the reason entirely for any drizzle query error:
 * the message is the whole SQL statement and the actual Postgres error lives in
 * `error.cause`, which never appears when a string is what gets logged.
 */
export async function main(body: () => Promise<void>): Promise<never> {
  try {
    await body();
  } catch (error) {
    console.error(errorFacts(error).join('\n'));
    if (error instanceof Error && error.stack) console.error(error.stack);
    return finish(1);
  }
  return finish(0);
}

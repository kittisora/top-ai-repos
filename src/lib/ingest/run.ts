/**
 * Job bookkeeping.
 *
 * Every pipeline stage runs inside a `sync_runs` row so a failed overnight run
 * is visible in the database instead of scrolling past in a terminal nobody was
 * watching. The row is opened BEFORE the job body runs and closed in a finally-
 * equivalent path, so a process that is hard-killed leaves a row stuck in
 * 'running' — that is deliberate: a stuck 'running' row is exactly the signal
 * that the worker died, and silently rewriting it to 'error' at the next start
 * would hide it.
 */

import { eq, sql } from 'drizzle-orm';

import { db, syncRuns } from '@/db';

/** Anything a job wants to report. jsonb, so keep it flat and primitive. */
export type JobStats = Record<string, number | string>;

export interface JobContext {
  /** The sync_runs row id, for jobs that want to reference it in their output. */
  runId: number;
  /** Timestamped progress line. Long runs must not be silent black boxes. */
  log: (message: string) => void;
}

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

/**
 * Truncated because `error` is a plain text column and a driver stack trace
 * from a 2,000-repo run can be tens of kilobytes of noise.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ''}`.slice(0, 8_000);
  }
  return String(error).slice(0, 8_000);
}

export async function withRun<T extends JobStats>(
  job: string,
  body: (ctx: JobContext) => Promise<T>,
): Promise<T> {
  const [row] = await db
    .insert(syncRuns)
    .values({ job, status: 'running' })
    .returning({ id: syncRuns.id });

  const runId = row!.id;
  const startedAt = Date.now();
  const log = (message: string) => console.log(`[${stamp()}] ${job}: ${message}`);

  log(`started (run #${runId})`);

  try {
    const stats = await body({ runId, log });
    const seconds = Math.round((Date.now() - startedAt) / 1000);

    await db
      .update(syncRuns)
      .set({
        status: 'ok',
        finishedAt: sql`now()`,
        stats: { ...stats, durationSeconds: seconds },
      })
      .where(eq(syncRuns.id, runId));

    log(`ok in ${seconds}s — ${JSON.stringify(stats)}`);
    return stats;
  } catch (error) {
    const seconds = Math.round((Date.now() - startedAt) / 1000);

    // A failure while writing the failure must not mask the original error.
    try {
      await db
        .update(syncRuns)
        .set({
          status: 'error',
          finishedAt: sql`now()`,
          error: describeError(error),
          stats: { durationSeconds: seconds },
        })
        .where(eq(syncRuns.id, runId));
    } catch (bookkeepingError) {
      console.error(`[${stamp()}] ${job}: could not record failure`, bookkeepingError);
    }

    log(`FAILED after ${seconds}s`);
    throw error;
  }
}

import { AlertTriangle, Database, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';

import type { DataError } from '@/components/data';
import { Code } from '@/components/ui';

/**
 * What a visitor sees when the index cannot be read or has nothing in it yet.
 *
 * These two states dominate the project's first ten minutes, so they get real
 * copy with the exact command to run rather than a spinner that never resolves
 * or a page of zeroes that looks like a bug.
 */

const GUIDANCE: Record<DataError['kind'], { title: string; steps: ReactNode }> = {
  'not-configured': {
    title: 'The database is not configured yet',
    steps: (
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          Copy <Code>.env.example</Code> to <Code>.env</Code>
        </li>
        <li>
          Set <Code>DATABASE_URL</Code> to a Postgres connection string
        </li>
        <li>
          Run <Code>npm run db:migrate</Code>, then <Code>npm run ingest</Code>
        </li>
      </ol>
    ),
  },
  'not-migrated': {
    title: 'The schema has not been created yet',
    steps: (
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          Run <Code>npm run db:migrate</Code> to create the tables
        </li>
        <li>
          Run <Code>npm run seed</Code> to load the category taxonomy
        </li>
        <li>
          Run <Code>npm run ingest</Code> to fill the index from GitHub
        </li>
      </ol>
    ),
  },
  unreachable: {
    title: 'Cannot reach the database',
    steps: (
      <p>
        The connection in <Code>DATABASE_URL</Code> was refused or timed out. Check that the
        Postgres server is running and that the host, port and{' '}
        <Code>sslmode</Code> in the URL are right.
      </p>
    ),
  },
  unknown: {
    title: 'The index could not be read',
    steps: (
      <p>
        Something went wrong talking to the database. The full error is in the server console.
      </p>
    ),
  },
};

export function SetupNotice({ error }: { error: DataError }) {
  const guidance = GUIDANCE[error.kind];

  return (
    <div
      role="alert"
      className="rounded-lg border border-warning/40 bg-warning/8 px-5 py-4 text-sm"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-primary">{guidance.title}</h2>
          <div className="mt-2 space-y-2 text-tertiary">{guidance.steps}</div>
          <pre className="mt-3 overflow-x-auto rounded border border-secondary bg-primary px-3 py-2 font-mono text-xs text-quaternary">
            {error.detail}
          </pre>
        </div>
      </div>
    </div>
  );
}

/**
 * Shown when the queries succeed but return nothing — the state after
 * `db:migrate` and before the first ingestion run.
 */
export function EmptyIndexNotice({
  what = 'repositories',
  compact = false,
}: {
  what?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <p className="rounded-lg border border-dashed border-primary bg-secondary px-4 py-6 text-center text-sm text-tertiary">
        No {what} indexed yet — run <Code>npm run ingest</Code>.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-primary bg-secondary px-6 py-12 text-center">
      <Database className="mx-auto size-6 text-quaternary" aria-hidden="true" />
      <h2 className="mt-3 text-base font-semibold">The index is empty</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-tertiary">
        No {what} have been discovered yet. The ingestion pipeline crawls GitHub, classifies
        each repository against the taxonomy and computes the trend and quality scores.
      </p>
      <div className="mx-auto mt-5 max-w-md space-y-2 text-left">
        <Step command="npm run db:migrate" note="create the tables" />
        <Step command="npm run seed" note="load the category taxonomy" />
        <Step command="npm run ingest" note="discover, sync, classify and score" />
      </div>
      <p className="mt-4 text-xs text-quaternary">
        Ingestion needs a <Code>GITHUB_TOKEN</Code> in <Code>.env</Code>.
      </p>
    </div>
  );
}

function Step({ command, note }: { command: string; note: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-secondary bg-primary px-3 py-2">
      <Terminal className="size-3.5 shrink-0 text-quaternary" aria-hidden="true" />
      <code className="font-mono text-xs font-medium">{command}</code>
      <span className="ml-auto text-xs text-quaternary">{note}</span>
    </div>
  );
}

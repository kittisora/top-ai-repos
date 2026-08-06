/**
 * Error reporting that survives drizzle.
 *
 * drizzle reports a failed query as `Failed query: <the entire SQL>` and hangs
 * the real Postgres error off `error.cause`. For a 500-row bulk insert that
 * message is tens of kilobytes of `$1, $2, default, …` and says nothing at all
 * about what went wrong; the diagnosis — `duplicate key value violates unique
 * constraint "contributors_login_uq"` — is one level down in `cause`.
 *
 * Neither `error.stack` nor `${error.name}: ${error.message}` includes it, and
 * `console.error(error.stack)` prints a string so Node never formats the
 * `[cause]` chain either. Both of those were in use here, which is how a plain
 * unique-constraint violation stayed unreadable across two days of nightly runs.
 *
 * Two rules follow from that, and both matter:
 *   1. Every message is CLIPPED. The useless part of a query error is enormous
 *      and the useful part is small, so an unclipped chain pushes the diagnosis
 *      past any storage cap — which is the exact failure this module exists to
 *      prevent.
 *   2. The root cause is stated FIRST, before the outer wrapper. The deepest
 *      cause is the diagnosis; it must not depend on surviving a truncation.
 *
 * Deliberately dependency-free: this is imported by both the ingestion library
 * and the CLI entry points, and must not drag a module graph behind it.
 */

/** Postgres error fields worth keeping. `detail` and `constraint` are usually
 * the whole diagnosis; `code` is what you grep for. */
const PG_ERROR_FIELDS = [
  'code',
  'detail',
  'constraint',
  'table',
  'column',
  'schema',
  'hint',
] as const;

/** Max `cause` links to follow, so a self-referential chain cannot spin. */
const MAX_DEPTH = 4;

/** Enough to identify a statement, nowhere near enough to bury the cause. */
const MAX_MESSAGE = 400;

function clip(text: string, max = MAX_MESSAGE): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}… (+${flat.length - max} more chars)`;
}

function pgFields(error: Error, indent: string): string[] {
  const bag = error as unknown as Record<string, unknown>;
  const lines: string[] = [];
  for (const field of PG_ERROR_FIELDS) {
    const value = bag[field];
    if (value !== undefined && value !== null) {
      lines.push(`${indent}${field}: ${clip(String(value))}`);
    }
  }
  return lines;
}

/** The deepest `cause`, which is where the actual reason lives. */
function rootCause(error: Error): Error {
  let current = error;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (!(current.cause instanceof Error)) break;
    current = current.cause;
  }
  return current;
}

/**
 * Flatten an error and everything that caused it into one fact per line.
 * Outermost first, each cause indented beneath the error it explains, every
 * message clipped.
 */
export function errorFacts(error: unknown, depth = 0): string[] {
  const indent = '  '.repeat(depth);
  if (depth > MAX_DEPTH) return [`${indent}… cause chain truncated`];
  if (!(error instanceof Error)) return [`${indent}${clip(String(error))}`];

  const facts = [`${indent}${error.name}: ${clip(error.message)}`];
  facts.push(...pgFields(error, `${indent}  `));

  if (error.cause !== undefined) {
    facts.push(`${indent}  caused by:`);
    facts.push(...errorFacts(error.cause, depth + 1));
  }
  return facts;
}

/**
 * A bounded, single-string description for storage.
 *
 * Leads with the root cause so the diagnosis is the first thing written and the
 * first thing read, then the full chain, then whatever stack still fits.
 */
export function describeError(error: unknown, maxLength: number): string {
  if (!(error instanceof Error)) return clip(String(error), maxLength);

  const root = rootCause(error);
  const lines: string[] = [];

  if (root !== error) {
    lines.push(`root cause: ${root.name}: ${clip(root.message)}`);
    lines.push(...pgFields(root, '  '));
  }
  lines.push(...errorFacts(error));

  const facts = lines.join('\n');
  if (facts.length >= maxLength) return facts.slice(0, maxLength);
  return `${facts}\n${error.stack ?? ''}`.slice(0, maxLength);
}

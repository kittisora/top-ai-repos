/**
 * Typed errors. Callers log `status` + `body` — a bare "403 Forbidden" is
 * useless when GitHub puts the entire diagnosis in the response body message.
 */
export class GitHubError extends Error {
  /** HTTP status, or 0 for a transport-level failure (DNS, socket, abort). */
  readonly status: number;
  readonly url: string;
  /** The `message` field of GitHub's JSON error body, or raw text. */
  readonly body: string;

  constructor(status: number, body: string, url = '') {
    super(`GitHub ${status || 'network'} ${url}${body ? `: ${body}` : ''}`.trim());
    this.name = 'GitHubError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/**
 * The query was too expensive for GitHub to execute: a 502/504 server timeout,
 * a client-side abort at 9s, or a `RESOURCE_LIMITS_EXCEEDED` error inside an
 * HTTP 200 body.
 *
 * NEVER retry the same query on this — a server-side timeout deducts extra
 * points from the hourly budget for the following hour, so a naive retry loop
 * burns the budget while returning zero rows. Halve the batch instead.
 */
export class GitHubTooHeavyError extends GitHubError {
  constructor(status: number, body: string, url = '') {
    super(status, body, url);
    this.name = 'GitHubTooHeavyError';
  }
}

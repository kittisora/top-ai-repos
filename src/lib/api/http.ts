/**
 * Response helpers shared by every route handler.
 *
 * Two things are enforced here rather than remembered per route: a `no-store`
 * cache header (this is live data — a CDN caching /api/repositories would serve
 * yesterday's trending list), and an error body shape that is the same whether
 * the failure came from zod, from a missing row, or from a thrown exception.
 */

import type { ZodError } from 'zod';

export interface ApiErrorBody {
  error: string;
  /** Present only for validation failures: one entry per bad field. */
  issues?: { field: string; message: string }[];
}

const NO_STORE: HeadersInit = {
  // GET route handlers are already dynamic by default in Next 16, but nothing
  // stops a proxy in front of the app from caching the response — this header
  // is the part that actually travels.
  'cache-control': 'no-store, max-age=0, must-revalidate',
};

export function jsonOk<T>(data: T, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE });
}

export function jsonError(status: number, error: string, issues?: ApiErrorBody['issues']): Response {
  const body: ApiErrorBody = issues ? { error, issues } : { error };
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * Turn a zod 4 failure into a 400 that tells the caller which parameter is
 * wrong and why. `issues[].path` is an array of segments; for query strings it
 * is always a single key.
 */
export function badRequest(error: ZodError, message = 'Invalid request parameters.'): Response {
  return jsonError(
    400,
    message,
    error.issues.map((issue) => ({
      field: issue.path.map(String).join('.') || '(body)',
      message: issue.message,
    })),
  );
}

/**
 * Never leak a database error message to the client — connection strings and
 * table structure show up in pg's error text. Log it server-side instead.
 */
export function serverError(error: unknown, context: string): Response {
  console.error(`[api] ${context}`, error);
  return jsonError(500, 'Something went wrong while querying the index.');
}

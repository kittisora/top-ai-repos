import type { NextRequest } from 'next/server';

import { badRequest, jsonOk, serverError } from '@/lib/api/http';
import { repoListQuerySchema, searchParamsToObject } from '@/lib/api/validation';
import { listRepositories } from '@/lib/queries';

/**
 * GET route handlers have been dynamic by default since Next 15, so this is
 * belt and braces — but it is the one line that guarantees a future
 * `export const revalidate` somewhere in the tree cannot start serving a
 * cached trending list.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const parsed = repoListQuerySchema.safeParse(
    searchParamsToObject(request.nextUrl.searchParams),
  );

  if (!parsed.success) {
    return badRequest(parsed.error, 'Invalid repository filter parameters.');
  }

  try {
    return jsonOk(await listRepositories(parsed.data));
  } catch (error) {
    return serverError(error, 'GET /api/repositories');
  }
}

import { jsonError, jsonOk, serverError } from '@/lib/api/http';
import { normalizeGitHubRepo } from '@/lib/api/validation';
import { getRepositoryByFullName } from '@/lib/queries';

export const dynamic = 'force-dynamic';

interface DetailContext {
  // Route params are Promises as of Next 15 — awaiting is not optional.
  params: Promise<{ owner: string; name: string }>;
}

export async function GET(_request: Request, context: DetailContext): Promise<Response> {
  const { owner, name } = await context.params;

  // Reuse the submission normaliser so the path segments go through exactly the
  // same owner/name validation as user-supplied URLs. It rejects path traversal
  // and anything that could not be a GitHub slug before it reaches a query.
  const normalized = normalizeGitHubRepo(`${owner}/${name}`);
  if (!normalized.ok) {
    return jsonError(400, normalized.error);
  }

  try {
    const repository = await getRepositoryByFullName(normalized.value.fullName);
    if (!repository) {
      return jsonError(404, `"${normalized.value.fullName}" is not in the index.`);
    }
    return jsonOk(repository);
  } catch (error) {
    return serverError(error, `GET /api/repositories/${normalized.value.fullName}`);
  }
}

import type { NextRequest } from 'next/server';

import { db } from '@/db';
import { submissions } from '@/db/schema';
import { badRequest, jsonError, jsonOk, serverError } from '@/lib/api/http';
import { normalizeGitHubRepo, submissionSchema } from '@/lib/api/validation';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  if (body === undefined || typeof body !== 'object' || body === null || Array.isArray(body)) {
    return jsonError(400, 'Expected a JSON object body: { "url": "...", "note": "..." }');
  }

  const parsed = submissionSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error, 'Invalid submission.');
  }

  const normalized = normalizeGitHubRepo(parsed.data.url);
  if (!normalized.ok) {
    return jsonError(400, normalized.error);
  }

  try {
    // ON CONFLICT DO NOTHING rather than SELECT-then-INSERT: two people
    // submitting the same repo at the same moment would both see "not found"
    // and one INSERT would then blow up on the unique index. An empty
    // RETURNING is the race-free signal that the row already existed.
    const [inserted] = await db
      .insert(submissions)
      .values({
        url: normalized.value.url,
        fullName: normalized.value.fullName,
        note: parsed.data.note ?? null,
      })
      .onConflictDoNothing({ target: submissions.url })
      .returning({
        id: submissions.id,
        url: submissions.url,
        fullName: submissions.fullName,
        status: submissions.status,
        createdAt: submissions.createdAt,
      });

    if (!inserted) {
      return jsonError(409, `${normalized.value.fullName} has already been submitted.`);
    }

    return jsonOk(inserted, 201);
  } catch (error) {
    return serverError(error, 'POST /api/submissions');
  }
}

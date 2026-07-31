import { jsonOk, serverError } from '@/lib/api/http';
import { getCategoryStats } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const groups = await getCategoryStats();
    return jsonOk({ groups });
  } catch (error) {
    return serverError(error, 'GET /api/categories');
  }
}

import { jsonOk, serverError } from '@/lib/api/http';
import { getGlobalStats } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    return jsonOk(await getGlobalStats());
  } catch (error) {
    return serverError(error, 'GET /api/stats');
  }
}

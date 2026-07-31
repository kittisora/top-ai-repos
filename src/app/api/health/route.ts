import { jsonError, jsonOk } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const { pool } = await import('@/db');
    // Verify a table required by application routes, not only the connection.
    // A missing or unapplied schema must fail readiness.
    await pool.query('SELECT 1 FROM repositories LIMIT 1');
    return jsonOk({ status: 'ok' });
  } catch (error) {
    console.error('[api] GET /api/health', error);
    return jsonError(503, 'Service unavailable.');
  }
}

import { allowedOrigins, type Env } from './config/env';
import { HttpError, json, secure } from './lib/http';
import { chat } from './routes/chat';
import type { Fetcher } from './lib/openai';

export async function handleRequest(request: Request, env: Env, fetcher: Fetcher = fetch): Promise<Response> {
  const startedAt = performance.now();
  let corsOrigin: string | null = null;
  try {
    const pathname = new URL(request.url).pathname;
    const origin = request.headers.get('Origin');
    if (origin) {
      let origins;
      try { origins = allowedOrigins(env); }
      catch { throw new HttpError(503, 'service_unavailable', 'The secretary is not configured yet.'); }
      if (!origins.includes(origin)) throw new HttpError(403, 'origin_not_allowed', 'This origin is not allowed.');
      corsOrigin = origin;
    }
    const method = pathname === '/health' ? 'GET' : pathname === '/chat' ? 'POST' : null;
    if (!method) throw new HttpError(404, 'not_found', 'Endpoint not found.');
    if (request.method === 'OPTIONS') {
      const requestedMethod = request.headers.get('Access-Control-Request-Method');
      const requestedHeaders = request.headers.get('Access-Control-Request-Headers')?.split(',').map((h) => h.trim().toLowerCase()) ?? [];
      if (!origin || requestedMethod !== method || requestedHeaders.some((h) => h !== 'content-type')) {
        throw new HttpError(403, 'invalid_preflight', 'This CORS request is not allowed.');
      }
      return secure(new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Methods': method,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      } }), corsOrigin);
    }
    if (request.method !== method) throw new HttpError(405, 'method_not_allowed', 'Method not allowed.', { Allow: `${method}, OPTIONS` });
    const response = pathname === '/health' ? json({ status: 'ok', service: 'secretary' }) : await chat(request, env, fetcher, startedAt);
    return secure(response, corsOrigin);
  } catch (error) {
    const safe = error instanceof HttpError ? error : new HttpError(500, 'internal_error', 'An unexpected error occurred.');
    // Do not log user content, credentials, or raw upstream errors.
    if (safe.status >= 500) console.error(JSON.stringify({ event: 'request_failed', status: safe.status, code: safe.code }));
    return secure(json({ error: { code: safe.code, message: safe.message } }, safe.status, safe.headers), corsOrigin);
  }
}

export default { fetch: (request: Request, env: Env) => handleRequest(request, env) } satisfies ExportedHandler<Env>;

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public headers: Record<string, string> = {}) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(data, { status, headers });
}

export function secure(response: Response, origin: string | null): Response {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Vary', 'Origin');
  if (origin) response.headers.set('Access-Control-Allow-Origin', origin);
  return response;
}

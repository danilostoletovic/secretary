import type { Env } from '../config/env';
import { converseWithAna, streamAna, type AnaContext } from '../core/ana';
import { readJson } from '../lib/body';
import { HttpError, json } from '../lib/http';
import type { Fetcher } from '../lib/openai';

export async function chat(request: Request, env: Env, fetcher: Fetcher, startedAt = performance.now()): Promise<Response> {
  // A public client may choose a language, never supply privileged instructions.
  const preference = request.headers.get('Accept-Language');
  const language = preference === null ? undefined
    : /^sr(?:-|$)/i.test((preference.split(',')[0]?.split(';')[0]?.trim() ?? '')) ? 'sr' : 'en';
  const context: AnaContext = {
    env,
    // Cloudflare sets this at ingress. Missing IPs share a conservative bucket.
    clientIp: request.headers.get('CF-Connecting-IP'),
    ...(language ? { language } : {}),
    signal: request.signal,
    startedAt,
    ...(env.ANA_METRICS === 'true' ? { onMetrics: metrics => console.log(JSON.stringify({ event: 'ana_latency', source: 'web-chat', model: env.OPENAI_MODEL ?? 'gpt-6.1-sol', transport: request.headers.get('Accept')?.includes('text/event-stream') ? 'sse' : 'json', ...metrics })) } : {}),
  };
  // Opt-in transport negotiation; existing API clients keep the JSON contract.
  if (!request.headers.get('Accept')?.split(',').some(value => value.trim().split(';')[0] === 'text/event-stream')) {
    return json(await converseWithAna(() => readJson(request), context, fetcher));
  }
  const upstream = await streamAna(() => readJson(request), context, fetcher);
  const encoder = new TextEncoder();
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed) return;
      try {
        const next = await upstream.events.next();
        if (closed) return;
        if (next.done) { closed = true; controller.close(); return; }
        controller.enqueue(encoder.encode(`event: ${next.value.type}\ndata: ${JSON.stringify(next.value)}\n\n`));
        if (next.value.type === 'done') {
          closed = true;
          await upstream.events.return(undefined);
          controller.close();
        }
      } catch (error) {
        if (closed) return;
        closed = true;
        const safe = error instanceof HttpError ? error : new HttpError(502, 'upstream_error', 'The secretary could not complete this request.');
        console.error(JSON.stringify({ event: 'request_failed', status: safe.status, code: safe.code }));
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: { code: safe.code, message: safe.message } })}\n\n`));
        controller.close();
      }
    },
    async cancel() { closed = true; await upstream.cancel(); await upstream.events.return(undefined); },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}

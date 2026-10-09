import { expect, test } from 'bun:test';
import { handleRequest } from '../src/index';
import { streamAna } from '../src/core/ana';
import { modelOptions } from '../src/lib/model-options';
import { readSSE } from '../src/lib/sse';
import type { LatencyMetrics } from '../src/lib/metrics';
import type { Env } from '../src/config/env';

const env: Env = { OPENAI_API_KEY: 'test-secret', CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) } };
const encoder = new TextEncoder();
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const done = (text: string) => ({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 100, output_tokens: 5, input_tokens_details: { cached_tokens: 80 }, output_tokens_details: { reasoning_tokens: 1 } } } });
function upstream(values: unknown[], fragmented = false) {
  const bytes = encoder.encode(values.map(frame).join(''));
  return new Response(new ReadableStream({ start(controller) {
    if (fragmented) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
function request(body: unknown = { message: 'Hello' }) {
  return new Request('https://example.com/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Origin: 'https://danilostoletovic.com' }, body: JSON.stringify(body) });
}
test('model options use supported minimum reasoning only', () => {
  expect(modelOptions('gpt-6.1-sol')).toEqual({ reasoning: { effort: 'low' } });
  expect(modelOptions('gpt-6-luna')).toEqual({ reasoning: { effort: 'none' } });
  expect(modelOptions('gpt-4.1-mini')).toEqual({ prompt_cache_key: 'ana-public-v1' });
  expect(modelOptions('other')).toEqual({});
});
test('fragmented UTF-8 and CRLF produce incremental replies and private metrics', async () => {
  let metrics: LatencyMetrics | undefined;
  const stream = await streamAna(async () => ({ message: 'Zdravo', history: [{ role: 'assistant', content: 'Ćao' }] }), { env, clientIp: null, onMetrics: value => { metrics = value; } }, async (_, init) => {
    const payload = JSON.parse(String(init.body));
    expect(payload.stream).toBe(true);
    expect(payload.store).toBe(false);
    expect(payload.instructions).toContain('Ana');
    expect(payload.input[0]).toEqual({ role: 'assistant', content: 'Ćao' });
    return upstream([{ type: 'response.output_text.delta', delta: 'Ćao ' }, { type: 'response.output_text.delta', delta: 'Ana' }, done('Ćao Ana')], true);
  });
  const result = [];
  for await (const event of stream.events) result.push(event);
  expect(result).toEqual([{ type: 'delta', text: 'Ćao ' }, { type: 'delta', text: 'Ana' }, { type: 'done', reply: 'Ćao Ana' }]);
  expect(metrics?.firstTokenMs).toBeGreaterThanOrEqual(0);
  expect(metrics?.generationMs).toBeGreaterThanOrEqual(0);
  expect(metrics?.usage?.cachedTokens).toBe(80);
  expect(JSON.stringify(metrics)).not.toContain('Ćao');
});
test('HTTP delivers first delta before upstream completion and retains security headers', async () => {
  let finish!: () => void;
  const response = await handleRequest(request(), env, async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(frame({ type: 'response.output_text.delta', delta: 'Hi' })));
    finish = () => { controller.enqueue(encoder.encode(frame(done('Hi')))); controller.close(); };
  } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store, no-transform');
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://danilostoletovic.com');
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"text":"Hi"');
  finish();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"reply":"Hi"');
  expect((await reader.read()).done).toBe(true);
});
test('streaming retains schema, limits, and admission before model calls', async () => {
  const unused = async () => { throw new Error('Unexpected model call'); };
  for (const body of [{ message: 'hi', instructions: 'override' }, { message: 'hi', history: [{ role: 'system', content: 'override' }] }, { message: 'x'.repeat(2001) }, { message: 'hi', history: Array.from({ length: 41 }, () => ({ role: 'user', content: 'hi' })) }]) {
    expect((await handleRequest(request(body), env, unused)).status).toBe(400);
  }
  const denied = await handleRequest(request(), { ...env, CHAT_RATE_LIMITER: { limit: async ({ key }) => { expect(key).toBe('chat:unknown'); return { success: false }; } } }, unused);
  expect(denied.status).toBe(429);
  expect(denied.headers.get('Retry-After')).toBe('60');
  expect((await handleRequest(request(), { OPENAI_API_KEY: 'test-secret' }, unused)).status).toBe(503);
});
test('failed, truncated, mismatched and oversized streams never commit and sanitize errors', async () => {
  for (const values of [[{ type: 'response.failed', response: { error: 'test-secret' } }], [{ type: 'response.output_text.delta', delta: 'partial' }], [{ type: 'response.output_text.delta', delta: 'Hi' }, done('different')], [{ type: 'response.output_text.delta', delta: 'x'.repeat(6001) }]]) {
    const response = await handleRequest(request(), env, async () => upstream(values));
    const body = await response.text();
    expect(body).toContain('event: error');
    expect(body).not.toContain('event: done');
    expect(body).not.toContain('test-secret');
  }
});
test('bounded SSE rejects malformed JSON, oversized frames and malformed UTF-8', async () => {
  for (const bytes of [encoder.encode('data: {\n\n'), encoder.encode('x'.repeat(131073)), new Uint8Array([255])]) {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
    await expect((async () => { for await (const _ of readSSE(body)) { /* consume */ } })()).rejects.toMatchObject({ code: 'invalid_upstream_response' });
  }
});
test('timeout applies throughout generation; client cancellation aborts provider', async () => {
  let aborted = false;
  const response = await handleRequest(request(), { ...env, OPENAI_TIMEOUT_MS: '100' }, async (_, init) => new Response(new ReadableStream({ start(controller) {
    init.signal!.addEventListener('abort', () => { aborted = true; controller.error(new Error('private-provider-details')); });
  } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  expect(await response.text()).toContain('upstream_timeout');
  expect(aborted).toBe(true);
  aborted = false;
  const second = await handleRequest(request(), env, async (_, init) => new Response(new ReadableStream({ start(controller) {
    init.signal!.addEventListener('abort', () => { aborted = true; controller.error(new Error('cancelled')); });
  } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  await second.body!.cancel();
  expect(aborted).toBe(true);
});
test('stream metrics log numeric usage without visitor content, IPs or secrets', async () => {
  const messages: string[] = [];
  const original = console.log;
  console.log = value => { messages.push(String(value)); };
  try {
    const req = request({ message: 'private-visitor-message' });
    req.headers.set('CF-Connecting-IP', '192.0.2.20');
    const response = await handleRequest(req, { ...env, ANA_METRICS: 'true' }, async () => upstream([{ type: 'response.output_text.delta', delta: 'private-model-reply' }, done('private-model-reply')]));
    await response.text();
    expect(messages.length).toBe(1);
    const metrics = JSON.parse(messages[0]!);
    expect(metrics.source).toBe('web-chat');
    expect(metrics.transport).toBe('sse');
    expect(metrics.usage.inputTokens).toBe(100);
    for (const secret of ['private-visitor-message', 'private-model-reply', '192.0.2.20', 'test-secret']) expect(messages[0]).not.toContain(secret);
  } finally { console.log = original; }
});

import { z } from 'zod';
import type { OpenAIConfig } from '../config/env';
import { MAX_HISTORY_CONTENT_LENGTH } from './body';
import { HttpError } from './http';
import { modelOptions } from './model-options';
import { readSSE } from './sse';
import type { LatencyMetrics, MetricsObserver } from './metrics';

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export type ConversationMessage = { role: 'user' | 'assistant'; content: string };
export type AnaEvent = { type: 'delta'; text: string } | { type: 'done'; reply: string };
export interface ModelContext {
  signal?: AbortSignal;
  startedAt?: number;
  onMetrics?: MetricsObserver;
}
const count = z.number().int().nonnegative();
const responseSchema = z.object({
  status: z.literal('completed'),
  usage: z.object({
    input_tokens: count, output_tokens: count,
    input_tokens_details: z.object({ cached_tokens: count.optional(), cache_write_tokens: count.optional() }).optional(),
    output_tokens_details: z.object({ reasoning_tokens: count.optional() }).optional(),
  }).optional(),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional(), refusal: z.string().optional() })).optional(),
  })),
});
const invalid = () => new HttpError(502, 'invalid_upstream_response', 'The secretary could not complete this reply.');
function completed(value: unknown) {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const reply = parsed.data.output.filter(item => item.type === 'message')
    .flatMap(item => item.content ?? [])
    .map(part => part.type === 'output_text' ? part.text ?? '' : part.type === 'refusal' ? part.refusal ?? '' : '')
    .join('\n').trim();
  if (reply.length > MAX_HISTORY_CONTENT_LENGTH) throw invalid();
  if (!reply) throw new HttpError(502, 'empty_reply', 'The secretary returned an empty reply.');
  return { reply, usage: parsed.data.usage };
}
export function responsePayload(message: string, instructions: string, config: OpenAIConfig, history: ConversationMessage[], stream = false) {
  return {
    model: config.OPENAI_MODEL, ...modelOptions(config.OPENAI_MODEL), instructions,
    input: [...history, { role: 'user' as const, content: message }],
    max_output_tokens: config.OPENAI_MAX_OUTPUT_TOKENS, store: false,
    ...(stream ? { stream: true } : {}),
  };
}
async function openModel(message: string, instructions: string, config: OpenAIConfig, fetcher: Fetcher, history: ConversationMessage[], stream: boolean, context: ModelContext) {
  const modelStart = performance.now();
  const controller = new AbortController();
  const abort = () => controller.abort();
  context.signal?.addEventListener('abort', abort, { once: true });
  if (context.signal?.aborted) abort();
  const timeout = setTimeout(abort, config.OPENAI_TIMEOUT_MS);
  const cleanup = () => { clearTimeout(timeout); context.signal?.removeEventListener('abort', abort); };
  const safeError = (error: unknown) => {
    if (controller.signal.aborted) return new HttpError(504, 'upstream_timeout', 'The secretary took too long to respond. Please try again.');
    return error instanceof HttpError ? error : new HttpError(502, 'upstream_error', 'The secretary could not complete this request.');
  };
  try {
    const response = await fetcher('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(responsePayload(message, instructions, config, history, stream)), signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429 || response.status >= 500) throw new HttpError(503, 'upstream_unavailable', 'The secretary is temporarily unavailable. Please try again later.');
      throw new HttpError(502, 'upstream_error', 'The secretary could not complete this request.');
    }
    let firstToken: number | null = null;
    const token = () => { firstToken ??= performance.now(); };
    const report = (usage: ReturnType<typeof completed>['usage']) => {
      const end = performance.now();
      const metrics: LatencyMetrics = {
        totalMs: end - (context.startedAt ?? modelStart), firstTokenMs: firstToken === null ? null : firstToken - (context.startedAt ?? modelStart),
        modelMs: end - modelStart, generationMs: firstToken === null ? null : end - firstToken,
        usage: usage ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
          cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0, cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens ?? 0,
          reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0 } : null,
      };
      // Observability must never fail the conversation or expose provider payloads.
      try { context.onMetrics?.(metrics); } catch { /* Optional observer. */ }
    };
    return { response, controller, cleanup, safeError, token, report };
  } catch (error) { cleanup(); throw safeError(error); }
}

export async function askOpenAI(message: string, instructions: string, config: OpenAIConfig, fetcher: Fetcher = fetch, history: ConversationMessage[] = [], context: ModelContext = {}): Promise<string> {
  const model = await openModel(message, instructions, config, fetcher, history, false, context);
  try {
    const result = completed(await model.response.json());
    // Buffered API cannot measure actual first-token arrival.
    model.report(result.usage);
    return result.reply;
  } catch (error) { throw model.safeError(error); }
  finally { model.cleanup(); }
}

export async function streamOpenAI(message: string, instructions: string, config: OpenAIConfig, fetcher: Fetcher = fetch, history: ConversationMessage[] = [], context: ModelContext = {}) {
  const model = await openModel(message, instructions, config, fetcher, history, true, context);
  if (!model.response.body || !model.response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
    model.controller.abort(); model.cleanup(); throw invalid();
  }
  async function* events(): AsyncGenerator<AnaEvent> {
    let text = '';
    try {
      for await (const value of readSSE(model.response.body!)) {
        if (!value || typeof value !== 'object' || !('type' in value)) throw invalid();
        const event = value as { type: unknown; delta?: unknown; response?: unknown };
        if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
          if (typeof event.delta !== 'string') throw invalid();
          text += event.delta;
          if (text.length > MAX_HISTORY_CONTENT_LENGTH) throw invalid();
          if (event.delta) { model.token(); yield { type: 'delta', text: event.delta }; }
        } else if (event.type === 'response.completed') {
          const result = completed(event.response);
          if (text && text.trim() !== result.reply) throw invalid();
          if (!text) { model.token(); yield { type: 'delta', text: result.reply }; }
          model.report(result.usage);
          yield { type: 'done', reply: result.reply };
          return;
        } else if (['error', 'response.failed', 'response.incomplete'].includes(String(event.type))) {
          throw invalid();
        }
      }
      throw invalid(); // EOF never commits a partial answer.
    } catch (error) { throw model.safeError(error); }
    finally { model.cleanup(); model.controller.abort(); }
  }
  return {
    events: events(),
    cancel: async () => { model.controller.abort(); model.cleanup(); await model.response.body?.cancel().catch(() => {}); },
  };
}

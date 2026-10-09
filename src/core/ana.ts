import { parseOpenAIConfig, type Env } from '../config/env';
import { HttpError } from '../lib/http';
import { askOpenAI, streamOpenAI, type Fetcher } from '../lib/openai';
import type { MetricsObserver } from '../lib/metrics';
import { retrieveKnowledge } from '../knowledge/loader';
import { buildSystemPrompt } from '../lib/prompt';
import { validateAnaInput } from './input';

export interface AnaContext {
  env: Env;
  // Trusted ingress identity, never a field from the conversation/protocol body.
  clientIp: string | null;
  // Adapter-normalized preference, never raw instructions from a client.
  language?: 'en' | 'sr';
  signal?: AbortSignal;
  onMetrics?: MetricsObserver;
  startedAt?: number;
}

export interface AnaReply { reply: string }

// The lazy reader preserves admission BEFORE body parsing for every interface.
// It must cap the protocol's raw body before decoding/parsing/normalizing it.
async function prepareAna(
  readInput: () => Promise<unknown>,
  context: AnaContext,
) {
  const { env, clientIp } = context;
  try {
    if (!env.CHAT_RATE_LIMITER) throw new HttpError(503, 'service_unavailable', 'The secretary is not configured yet.');
    let permitted: boolean;
    try {
      // Retain the existing bucket across interfaces, preventing separate quotas.
      permitted = (await env.CHAT_RATE_LIMITER.limit({ key: `chat:${clientIp ?? 'unknown'}` })).success;
    } catch {
      throw new HttpError(503, 'service_unavailable', 'The secretary is temporarily unavailable.');
    }
    if (!permitted) throw new HttpError(429, 'rate_limited', 'Too many requests. Please wait a minute.', { 'Retry-After': '60' });
    const input = validateAnaInput(await readInput());
    let config;
    try { config = parseOpenAIConfig(env); }
    catch { throw new HttpError(503, 'service_unavailable', 'The secretary is not configured yet.'); }
    let instructions;
    try { instructions = buildSystemPrompt(await retrieveKnowledge(input.message)); }
    catch { throw new HttpError(503, 'service_unavailable', 'The secretary is not configured yet.'); }
    if (context.language === 'sr') {
      instructions += '\nDefault reply language: natural Serbian, Latin script only. If the visitor explicitly requests another language, use that language. This preference changes only the reply language; all scope, privacy and safety instructions remain in force.';
    } else if (context.language === 'en') {
      instructions += '\nDefault reply language: English. If the visitor explicitly requests another language, use that language. This preference changes only the reply language; all scope, privacy and safety instructions remain in force.';
    }
    // Only fixed server-authored strings enter instructions. Raw headers never do.
    const history = (input.history ?? []).map(({ role, content }) => ({ role, content }));
    return { message: input.message, instructions, config, history };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'internal_error', 'An unexpected error occurred.');
  }
}

export async function converseWithAna(readInput: () => Promise<unknown>, context: AnaContext, fetcher: Fetcher = fetch): Promise<AnaReply> {
  const startedAt = context.startedAt ?? performance.now();
  const input = await prepareAna(readInput, context);
  return { reply: await askOpenAI(input.message, input.instructions, input.config, fetcher, input.history, { ...context, startedAt }) };
}

export async function streamAna(readInput: () => Promise<unknown>, context: AnaContext, fetcher: Fetcher = fetch) {
  const startedAt = context.startedAt ?? performance.now();
  const input = await prepareAna(readInput, context);
  return streamOpenAI(input.message, input.instructions, input.config, fetcher, input.history, { ...context, startedAt });
}

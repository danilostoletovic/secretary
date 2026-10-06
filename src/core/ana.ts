import { parseOpenAIConfig, type Env } from '../config/env';
import { HttpError } from '../lib/http';
import { askOpenAI, type Fetcher } from '../lib/openai';
import { retrieveKnowledge } from '../knowledge/loader';
import { buildSystemPrompt } from '../lib/prompt';
import { validateAnaInput } from './input';

export interface AnaContext {
  env: Env;
  // Trusted ingress identity, never a field from the conversation/protocol body.
  clientIp: string | null;
}

export interface AnaReply { reply: string }

// The lazy reader preserves admission BEFORE body parsing for every interface.
// It must cap the protocol's raw body before decoding/parsing/normalizing it.
export async function converseWithAna(
  readInput: () => Promise<unknown>,
  context: AnaContext,
  fetcher: Fetcher = fetch,
): Promise<AnaReply> {
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
    const history = (input.history ?? []).map(({ role, content }) => ({ role, content }));
    return { reply: await askOpenAI(input.message, instructions, config, fetcher, history) };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'internal_error', 'An unexpected error occurred.');
  }
}

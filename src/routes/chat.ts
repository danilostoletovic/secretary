import { z } from 'zod';
import { parseOpenAIConfig, type Env } from '../config/env';
import { MAX_HISTORY_CONTENT_LENGTH, MAX_HISTORY_MESSAGES, MAX_HISTORY_TOTAL_LENGTH, MAX_MESSAGE_LENGTH, readJson } from '../lib/body';
import { HttpError, json } from '../lib/http';
import { askOpenAI, type Fetcher } from '../lib/openai';
import { retrieveKnowledge } from '../knowledge/loader';
import { buildSystemPrompt } from '../lib/prompt';

const historyMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(MAX_HISTORY_CONTENT_LENGTH),
}).strict();
const inputSchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  history: z.array(historyMessageSchema).max(MAX_HISTORY_MESSAGES).optional(),
}).strict().superRefine((input, context) => {
  const total = input.history?.reduce((sum, item) => sum + item.content.length, 0) ?? 0;
  if (total > MAX_HISTORY_TOTAL_LENGTH) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['history'], message: 'History is too long.' });
  }
});

// Client history is conversational data, never authoritative instructions.
function normalizedHistory(history: z.infer<typeof inputSchema>['history']) {
  return (history ?? []).map(({ role, content }) => ({ role, content }));
}

export async function chat(request: Request, env: Env, fetcher: Fetcher): Promise<Response> {
  if (!env.CHAT_RATE_LIMITER) throw new HttpError(503, 'service_unavailable', 'The secretary is not configured yet.');
  let permitted: boolean;
  try {
    // Cloudflare sets this header at ingress. Missing IPs share a conservative bucket.
    const key = `chat:${request.headers.get('CF-Connecting-IP') ?? 'unknown'}`;
    permitted = (await env.CHAT_RATE_LIMITER.limit({ key })).success;
  } catch {
    throw new HttpError(503, 'service_unavailable', 'The secretary is temporarily unavailable.');
  }
  if (!permitted) throw new HttpError(429, 'rate_limited', 'Too many requests. Please wait a minute.', { 'Retry-After': '60' });
  const input = inputSchema.safeParse(await readJson(request));
  if (!input.success) throw new HttpError(400, 'invalid_request', 'Provide a valid message and optional conversation history within the allowed limits.');
  let config;
  try { config = parseOpenAIConfig(env); }
  catch { throw new HttpError(503, 'service_unavailable', 'The secretary is not configured yet.'); }
  let instructions;
  try { instructions = buildSystemPrompt(await retrieveKnowledge(input.data.message)); }
  catch { throw new HttpError(503, 'service_unavailable', 'The secretary is not configured yet.'); }
  return json({ reply: await askOpenAI(input.data.message, instructions, config, fetcher, normalizedHistory(input.data.history)) });
}

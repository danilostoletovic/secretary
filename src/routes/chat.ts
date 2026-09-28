import { z } from 'zod';
import { parseOpenAIConfig, type Env } from '../config/env';
import { MAX_MESSAGE_LENGTH, readJson } from '../lib/body';
import { HttpError, json } from '../lib/http';
import { askOpenAI, type Fetcher } from '../lib/openai';

const inputSchema = z.object({ message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) }).strict();

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
  if (!input.success) throw new HttpError(400, 'invalid_request', `Provide only a message containing 1–${MAX_MESSAGE_LENGTH} characters.`);
  let config;
  try { config = parseOpenAIConfig(env); }
  catch { throw new HttpError(503, 'service_unavailable', 'The secretary is not configured yet.'); }
  return json({ reply: await askOpenAI(input.data.message, config, fetcher) });
}

import { z } from 'zod';

export interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  ALLOWED_ORIGINS?: string;
  OPENAI_TIMEOUT_MS?: string;
  OPENAI_MAX_OUTPUT_TOKENS?: string;
  CHAT_RATE_LIMITER?: Pick<RateLimit, 'limit'>;
}

const origin = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch { return false; }
});

export function allowedOrigins(env: Env): string[] {
  return z.array(origin).min(1).parse(
    (env.ALLOWED_ORIGINS ?? 'https://danilostoletovic.com,https://www.danilostoletovic.com')
      .split(',').map((value) => value.trim()),
  );
}

const schema = z.object({
  OPENAI_API_KEY: z.string().trim().min(1).refine((v) => v !== 'replace-with-your-openai-api-key'),
  OPENAI_MODEL: z.string().trim().min(1).default('gpt-6.1-sol'),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(20000),
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(16).max(2000).default(400),
});

export const parseOpenAIConfig = (env: Env) => schema.parse(env);
export type OpenAIConfig = z.infer<typeof schema>;

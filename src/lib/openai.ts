import { z } from 'zod';
import type { OpenAIConfig } from '../config/env';
import { secretaryInstructions } from '../config/personality';
import { HttpError } from './http';

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const responseSchema = z.object({
  status: z.literal('completed'),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional(), refusal: z.string().optional() })).optional(),
  })),
});

export async function askOpenAI(message: string, config: OpenAIConfig, fetcher: Fetcher = fetch): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.OPENAI_TIMEOUT_MS);
  try {
    const response = await fetcher('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.OPENAI_MODEL,
        instructions: secretaryInstructions,
        input: [{ role: 'user', content: message }],
        max_output_tokens: config.OPENAI_MAX_OUTPUT_TOKENS,
        store: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429 || response.status >= 500) {
        throw new HttpError(503, 'upstream_unavailable', 'The secretary is temporarily unavailable. Please try again later.');
      }
      throw new HttpError(502, 'upstream_error', 'The secretary could not complete this request.');
    }
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new HttpError(502, 'invalid_upstream_response', 'The secretary could not complete this reply.');
    const reply = parsed.data.output.filter((item) => item.type === 'message')
      .flatMap((item) => item.content ?? [])
      .map((part) => part.type === 'output_text' ? part.text ?? '' : part.type === 'refusal' ? part.refusal ?? '' : '')
      .join('\n').trim();
    if (!reply) throw new HttpError(502, 'empty_reply', 'The secretary returned an empty reply. Please try again.');
    return reply;
  } catch (error) {
    if (controller.signal.aborted) throw new HttpError(504, 'upstream_timeout', 'The secretary took too long to respond. Please try again.');
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'upstream_error', 'The secretary could not complete this request.');
  } finally { clearTimeout(timeout); }
}

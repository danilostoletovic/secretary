import type { Env } from '../config/env';
import { converseWithAna } from '../core/ana';
import { readJson } from '../lib/body';
import { json } from '../lib/http';
import type { Fetcher } from '../lib/openai';

export async function chat(request: Request, env: Env, fetcher: Fetcher): Promise<Response> {
  // A public client may choose a language, never supply privileged instructions.
  const preference = request.headers.get('Accept-Language');
  const language = preference === null ? undefined
    : /^sr(?:-|$)/i.test((preference.split(',')[0]?.split(';')[0]?.trim() ?? '')) ? 'sr' : 'en';
  return json(await converseWithAna(() => readJson(request), {
    env,
    // Cloudflare sets this at ingress. Missing IPs share a conservative bucket.
    clientIp: request.headers.get('CF-Connecting-IP'),
    ...(language ? { language } : {}),
  }, fetcher));
}

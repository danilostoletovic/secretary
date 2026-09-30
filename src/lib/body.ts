import { HttpError } from './http';

export const MAX_BODY_BYTES = 16384;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_HISTORY_MESSAGES = 40;
export const MAX_HISTORY_CONTENT_LENGTH = 6000;
export const MAX_HISTORY_TOTAL_LENGTH = 12000;

export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'unsupported_media_type', 'Use Content-Type: application/json.');
  }
  if (request.headers.has('content-encoding') && request.headers.get('content-encoding') !== 'identity') {
    throw new HttpError(415, 'unsupported_encoding', 'Compressed request bodies are not supported.');
  }
  const tooLarge = () => new HttpError(413, 'body_too_large', 'Request body exceeds 16 KiB.');
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw tooLarge();
  if (!request.body) throw new HttpError(400, 'invalid_json', 'Provide a JSON request body.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'invalid_json', 'Provide valid UTF-8 JSON.');
  } finally { reader.releaseLock(); }
}

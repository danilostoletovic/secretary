import { HttpError } from './http';

// Bounded incremental UTF-8 parsing, including fragmented CRLF and multi-line data.
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let buffer = '', bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error('Stream too large');
      buffer += decoder.decode(value, { stream: true });
      let separator: RegExpExecArray | null;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        if (frame.length > 131072) throw new Error('Event too large');
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (data && data !== '[DONE]') yield JSON.parse(data) as unknown;
      }
      if (buffer.length > 131072) throw new Error('Event too large');
    }
    buffer += decoder.decode();
    if (buffer.trim()) throw new Error('Truncated stream');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'invalid_upstream_response', 'The secretary could not complete this reply.');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

import { z } from 'zod';
import { MAX_BODY_BYTES, MAX_HISTORY_CONTENT_LENGTH, MAX_HISTORY_MESSAGES, MAX_HISTORY_TOTAL_LENGTH, MAX_MESSAGE_LENGTH } from '../lib/body';
import { HttpError } from '../lib/http';

const historyMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(MAX_HISTORY_CONTENT_LENGTH),
}).strict().refine(item => item.role !== 'user' || item.content.length <= MAX_MESSAGE_LENGTH);
const inputSchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  history: z.array(historyMessageSchema).max(MAX_HISTORY_MESSAGES).optional(),
}).strict().superRefine((input, context) => {
  const total = input.history?.reduce((sum, item) => sum + item.content.length, 0) ?? 0;
  if (total > MAX_HISTORY_TOTAL_LENGTH) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['history'], message: 'History is too long.' });
  }
});

export type AnaInput = z.infer<typeof inputSchema>;

// Revalidate adapter-produced input; callers cannot provide privileged instructions.
export function validateAnaInput(source: unknown): AnaInput {
  const input = inputSchema.safeParse(source);
  if (!input.success) throw new HttpError(400, 'invalid_request', 'Provide a valid message and optional conversation history within the allowed limits.');
  // All adapters must also bound their raw wire envelope before parsing it.
  if (new TextEncoder().encode(JSON.stringify(input.data)).byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, 'body_too_large', 'Request body exceeds 16 KiB.');
  }
  return input.data;
}
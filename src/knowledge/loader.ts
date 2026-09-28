import { z } from 'zod';
import profile from './profile.md' with { type: 'text' };
import policies from './policies.md' with { type: 'text' };
import services from './services.json';
import projects from './projects.json';

const text = z.string().trim().min(1);
const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const service = z.object({ id, name: text, description: text, available: z.boolean() }).strict().readonly();
const project = z.object({
  id, name: text, description: text,
  technologies: z.array(text).readonly(),
  features: z.array(text).readonly(),
  links: z.array(z.object({
    label: text,
    url: z.url().refine((value) => ['https:', 'http:'].includes(new URL(value).protocol)),
  }).strict().readonly()).readonly(),
}).strict().readonly();
const uniqueIds = (items: readonly { id: string }[]) => new Set(items.map((item) => item.id)).size === items.length;
const knowledgeSchema = z.object({
  profile: text,
  policies: text,
  services: z.object({
    schemaVersion: z.literal(1), services: z.array(service).min(1).refine(uniqueIds).readonly(),
  }).strict().readonly(),
  projects: z.object({
    schemaVersion: z.literal(1), projects: z.array(project).min(1).refine(uniqueIds).readonly(),
  }).strict().readonly(),
}).strict().readonly();

export type Knowledge = z.infer<typeof knowledgeSchema>;

// Validate before caching or making a paid call. Never include source contents in errors.
export function loadKnowledge(source: unknown): Knowledge {
  const result = knowledgeSchema.safeParse(source);
  if (!result.success) throw new Error('Invalid public knowledge configuration.');
  return result.data;
}

let cached: Knowledge | undefined;

// Files are bundled by Wrangler: no filesystem access in the Worker and no public assets.
export function getAllKnowledge(): Knowledge {
  return cached ??= loadKnowledge({ profile, policies, services, projects });
}

// Future retrieval plugs in here. Keep identity/policies trusted and always present;
// use the query only to select relevant public facts, never as trusted instructions.
export async function retrieveKnowledge(_userQuery: string): Promise<Knowledge> {
  return getAllKnowledge();
}

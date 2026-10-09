import { baseSecretaryInstructions } from '../config/personality';
import type { Knowledge } from '../knowledge/loader';

const prompts = new WeakMap<Knowledge, string>();

export function buildSystemPrompt(knowledge: Knowledge): string {
  const cached = prompts.get(knowledge);
  if (cached) return cached;
  const prompt = [
    baseSecretaryInstructions,
    'Ana canon (fictional; not facts about Danilo):', knowledge.anaLore,
    'Approved public profile:', knowledge.profile,
    'Approved services (offered, not current capacity):', JSON.stringify(knowledge.services),
    'Approved projects:', JSON.stringify(knowledge.projects),
    'Secretary policies:', knowledge.policies,
  ].join('\n\n');
  prompts.set(knowledge, prompt);
  return prompt;
}

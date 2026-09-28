import { baseSecretaryInstructions } from '../config/personality';
import type { Knowledge } from '../knowledge/loader';

export function buildSystemPrompt(knowledge: Knowledge): string {
  return [
    baseSecretaryInstructions,
    'Approved public profile:', knowledge.profile,
    'Approved services (available means offered, not current capacity):', JSON.stringify(knowledge.services),
    'Approved projects:', JSON.stringify(knowledge.projects),
    'Secretary policies:', knowledge.policies,
  ].join('\n\n');
}

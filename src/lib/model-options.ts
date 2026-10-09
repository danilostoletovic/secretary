// Verified against official model pages. Unknown models omit optional parameters.
export function modelOptions(model: string): Record<string, unknown> {
  if (/^gpt-6\.1-sol(?:-|$)/.test(model)) return { reasoning: { effort: 'low' } };
  if (/^gpt-6-luna(?:-|$)/.test(model)) return { reasoning: { effort: 'none' } };
  if (/^gpt-4\.1-mini(?:-|$)/.test(model)) return { prompt_cache_key: 'ana-public-v1' };
  return {};
}

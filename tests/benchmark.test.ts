import { test, expect } from 'bun:test';
import { cases, percentile, estimatedCost } from '../scripts/benchmark';
test('benchmark uses twenty distinct cases and correct percentile/cached cost math', () => {
  expect(cases.length).toBe(20);
  expect(new Set(cases.map(([id]) => id)).size).toBe(20);
  expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), .5)).toBe(10.5);
  expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), .95)).toBe(19);
  expect(estimatedCost('gpt-6-luna', { totalMs: 1, firstTokenMs: 1, modelMs: 1, generationMs: 0, usage: { inputTokens: 1000, cachedTokens: 600, cacheWriteTokens: 200, outputTokens: 100, reasoningTokens: 0 } })).toBeCloseTo(.000101, 8);
});

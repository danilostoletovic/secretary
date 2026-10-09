export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}
export interface LatencyMetrics {
  totalMs: number;
  firstTokenMs: number | null;
  modelMs: number;
  generationMs: number | null;
  usage: TokenUsage | null;
}
export type MetricsObserver = (metrics: LatencyMetrics) => void;

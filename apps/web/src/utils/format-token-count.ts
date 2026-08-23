const TOKENS_PER_K = 1_000;
const K_THRESHOLD_FOR_M = 1_024;
const TOKENS_PER_M = TOKENS_PER_K * K_THRESHOLD_FOR_M;

export function formatTokenCount(value: number): string {
  const rounded = Math.round(value);
  if (rounded <= 0) return "0";
  if (rounded >= TOKENS_PER_M) return `${(rounded / TOKENS_PER_M).toFixed(1)}M`;
  if (rounded >= TOKENS_PER_K) return `${(rounded / TOKENS_PER_K).toFixed(1)}K`;
  return String(rounded);
}

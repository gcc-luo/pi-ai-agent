/**
 * Shared numeric/normalization helpers used by skill providers and preview rendering.
 *
 * Consolidated from per-provider copies of {@link parseCompactNumber} and
 * {@link numericPopularity} that were duplicated across preview.ts,
 * skills-sh-provider.ts, and skillsmp-provider.ts. Each copy used the same
 * regex and multiplier table; the only divergence was the return type
 * (`number | undefined` for previews, `number` for providers). The unified
 * helpers keep the strict {@link parseCompactNumberStrict} variant for
 * previews and a defaulting {@link parseCompactNumber} variant for providers.
 */

const COMPACT_NUMBER_PATTERN = /^(\d+(?:\.\d+)?)([KMB])?$/u;

function normalizeCompactNumberInput(value: string): string {
  return value.trim().replace(/,/gu, "").toUpperCase();
}

function compactMultiplier(suffix: string | undefined): number {
  if (suffix === "K") {
    return 1_000;
  }
  if (suffix === "M") {
    return 1_000_000;
  }
  if (suffix === "B") {
    return 1_000_000_000;
  }
  return 1;
}

/**
 * Parse a compact number string (e.g. "1.2K", "3,500", "2M") returning
 * `undefined` when the input cannot be parsed. Used by preview rendering
 * where a missing value is meaningful.
 *
 * Behaves identically to the previous preview-local copy: trims, strips
 * commas, uppercases, and falls back to integer parsing of the digits.
 */
export function parseCompactNumberStrict(value: string): number | undefined {
  const normalized = normalizeCompactNumberInput(value);
  const match = normalized.match(COMPACT_NUMBER_PATTERN);
  if (!match) {
    const parsed = Number.parseInt(normalized.replace(/[^\d]/gu, ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  const amount = Number.parseFloat(match[1] ?? "0");
  return Math.round(amount * compactMultiplier(match[2]));
}

/**
 * Parse a compact number string, defaulting to `0` when parsing fails.
 * Used by providers that treat missing popularity as zero.
 *
 * Delegates to {@link parseCompactNumberStrict} and coerces `undefined`
 * to `0`, preserving the previous provider-local behavior. Negative
 * results are clamped to `0` because popularity is never negative.
 */
export function parseCompactNumber(value: string): number {
  return Math.max(0, parseCompactNumberStrict(value) ?? 0);
}

/**
 * Normalize a raw popularity value (number, compact-number string, or
 * missing) into a finite number, defaulting to `0`.
 */
export function numericPopularity(value: number | string | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    return parseCompactNumber(value);
  }
  return 0;
}

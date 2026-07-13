/**
 * Deduplicate items by a computed key, keeping the item that scores highest
 * according to `compare` (returns > 0 when `a` should replace `b`).
 *
 * Consolidates the Map-based "keep best per key" loop that was duplicated
 * between per-provider result deduplication and the cross-provider search
 * deduplication.
 */
export function deduplicateByKey<T>(
  items: readonly T[],
  keyFn: (item: T) => string,
  compare: (candidate: T, existing: T) => number,
): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    const key = keyFn(item);
    const existing = seen.get(key);
    if (!existing || compare(item, existing) > 0) {
      seen.set(key, item);
    }
  }
  return [...seen.values()];
}

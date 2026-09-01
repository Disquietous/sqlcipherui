/**
 * Bounded subsequence matcher used only as a fallback when a prefix lookup
 * yields too few results. Callers must pass an already-narrowed candidate set.
 */

/** Score `query` as a subsequence of `key` (both lowercase); -1 if no match. */
export function fuzzyScore(query, key) {
  if (query.length > key.length) return -1;
  let score = 0, qi = 0, prevIdx = -2;
  for (let ki = 0; ki < key.length && qi < query.length; ki++) {
    if (key.charCodeAt(ki) !== query.charCodeAt(qi)) continue;
    score += 1;
    if (ki === prevIdx + 1) score += 2;          // consecutive
    if (ki === 0 || key[ki - 1] === '_') score += 3; // word start
    prevIdx = ki;
    qi++;
  }
  if (qi !== query.length) return -1;
  if (key.startsWith(query)) score += 5;
  return score - (key.length - query.length) * 0.05;
}

/** Best `limit` fuzzy matches from `items` (scanning at most `maxScan`). */
export function fuzzyFilter(items, query, { limit = 30, maxScan = 4000 } = {}) {
  const out = [];
  const n = Math.min(items.length, maxScan);
  for (let i = 0; i < n; i++) {
    const s = fuzzyScore(query, items[i].key);
    if (s >= 0) out.push([s, items[i]]);
  }
  out.sort((a, b) => b[0] - a[0]);
  return out.slice(0, limit).map((x) => x[1]);
}

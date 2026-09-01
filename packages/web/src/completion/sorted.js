/**
 * Binary-search helpers over arrays sorted by a pre-lowercased string `key`.
 * All completion lookups go through these so a keystroke costs O(log n).
 */

/** First index whose key is >= `key`. */
export function lowerBound(arr, key) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].key < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** [start, end) of entries whose key starts with `prefix`. */
export function prefixRange(arr, prefix) {
  if (!prefix) return [0, arr.length];
  return [lowerBound(arr, prefix), lowerBound(arr, prefix + '￿')];
}

/** Entries whose key starts with `prefix`, capped at `limit`. */
export function prefixSlice(arr, prefix, limit = Infinity) {
  const [lo, hi] = prefixRange(arr, prefix);
  return arr.slice(lo, Math.min(hi, lo + limit));
}

/** Sort in place by key (then label for stability). */
export function sortByKey(arr) {
  return arr.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

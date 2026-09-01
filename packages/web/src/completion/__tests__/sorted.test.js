import { describe, it, expect } from 'vitest';
import { lowerBound, prefixRange, prefixSlice, sortByKey } from '../sorted';
import { fuzzyFilter, fuzzyScore } from '../fuzzy';

const mk = (...names) => sortByKey(names.map((n) => ({ key: n.toLowerCase(), label: n })));

describe('sorted helpers', () => {
  const arr = mk('users', 'user_roles', 'posts', 'post_tags', 'Accounts', 'accounts_archive');

  it('lowerBound finds first key >= needle', () => {
    expect(lowerBound(arr, 'a')).toBe(0);
    expect(lowerBound(arr, 'post')).toBe(2);
    expect(lowerBound(arr, 'zzz')).toBe(arr.length);
  });

  it('prefixRange covers exactly the prefixed entries', () => {
    const [lo, hi] = prefixRange(arr, 'post');
    expect(arr.slice(lo, hi).map((x) => x.label)).toEqual(['post_tags', 'posts']);
    expect(prefixRange(arr, '')).toEqual([0, arr.length]);
    expect(prefixSlice(arr, 'user', 1).map((x) => x.label)).toEqual(['user_roles']);
    expect(prefixSlice(arr, 'nope')).toEqual([]);
  });

  it('is case-insensitive via lowercased keys', () => {
    expect(prefixSlice(arr, 'acc').map((x) => x.label)).toEqual(['Accounts', 'accounts_archive']);
  });
});

describe('fuzzy', () => {
  it('scores subsequences and rejects non-matches', () => {
    expect(fuzzyScore('usr', 'users')).toBeGreaterThan(0);
    expect(fuzzyScore('uid', 'user_id')).toBeGreaterThan(fuzzyScore('uid', 'unique_identity_d'));
    expect(fuzzyScore('xyz', 'users')).toBe(-1);
  });
  it('filters and ranks', () => {
    const arr = mk('user_id', 'uid', 'unrelated', 'guid');
    expect(fuzzyFilter(arr, 'uid').map((x) => x.label)).toEqual(['uid', 'user_id', 'guid']);
  });
});

import { describe, it, expect } from 'vitest';
import { buildIndex } from '../index';
import { prefixSlice } from '../sorted';
import { SNAPSHOT } from './fixture';

describe('buildIndex', () => {
  const idx = buildIndex(SNAPSHOT);

  it('sorts objects and exposes lookups by plain and qualified name', () => {
    expect(idx.objects.map((o) => o.label)).toEqual(['active_users', 'posts', 'remote_notes', 'users']);
    expect(idx.objectsByKey.get('users').kind).toBe('table');
    expect(idx.objectsByKey.get('active_users').kind).toBe('view');
    expect(idx.objectsByKey.get('aux.remote_notes').schema).toBe('aux');
    expect(idx.tablesBySchema.get('aux').map((o) => o.label)).toEqual(['remote_notes']);
  });

  it('indexes columns per owner (sorted) and aggregated', () => {
    expect(idx.columnsByOwner.get('posts').map((c) => c.label)).toEqual(['body', 'id', 'title', 'user_id']);
    expect(prefixSlice(idx.columnsByOwner.get('users'), 'e').map((c) => c.label)).toEqual(['email']);
    const id = idx.allColumns.find((c) => c.key === 'id');
    expect(id.owners.sort()).toEqual(['active_users', 'posts', 'remote_notes', 'users']);
  });

  it('indexes foreign keys both directions', () => {
    expect(idx.fkByFrom.get('posts')[0].to_table).toBe('users');
    expect(idx.fkByTo.get('users')[0].from_column).toBe('user_id');
  });

  it('records table flags', () => {
    expect(idx.objectsByKey.get('users').withoutRowid).toBe(false);
    expect(idx.indexes[0].table).toBe('posts');
    expect(idx.triggers[0].label).toBe('trg_posts');
  });
});

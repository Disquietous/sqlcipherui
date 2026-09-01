import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { sql, SQLite } from '@codemirror/lang-sql';
import { buildIndex } from '../index';
import { sqlCompletionSource } from '../source';
import { SNAPSHOT } from './fixture';

const index = buildIndex(SNAPSHOT);
const source = sqlCompletionSource(() => index);

function complete(text, explicit = false) {
  const pos = text.indexOf('|');
  const doc = text.replace('|', '');
  const state = EditorState.create({ doc, extensions: [sql({ dialect: SQLite })] });
  const ctx = new CompletionContext(state, pos, explicit);
  return source(ctx);
}
const labels = (r) => (r ? r.options.map((o) => o.label) : []);

describe('sqlCompletionSource', () => {
  it('is silent without a word unless explicit or after a dot', () => {
    expect(complete('SELECT * FROM |')).toBeNull();
    expect(labels(complete('SELECT * FROM |', true))).toContain('users');
  });

  it('completes tables by prefix', () => {
    const r = complete('SELECT * FROM us|');
    expect(r.from).toBe('SELECT * FROM '.length);
    expect(labels(r)[0]).toBe('users');
    expect(labels(r)).toContain('active_users'); // fuzzy fallback when prefix hits are sparse
    expect(labels(complete('SELECT * FROM po|'))).toEqual(['posts']);
    expect(String(r.validFor)).toBe(String(/^[\w$]*$/));
  });

  it('completes alias-qualified columns after a dot', () => {
    const r = complete('SELECT u.| FROM users u');
    expect(labels(r)).toEqual(['*', 'email', 'id', 'role']);
    expect(labels(complete('SELECT u.e| FROM users u'))).toEqual(['email']);
  });

  it('completes schema-qualified tables', () => {
    expect(labels(complete('SELECT * FROM aux.|'))).toEqual(['remote_notes']);
    expect(labels(complete('SELECT * FROM main.users.|'))).toContain('email');
  });

  it('scope columns carry owner detail and outrank tables', () => {
    const r = complete('SELECT * FROM users u JOIN posts p WHERE i|');
    const opts = r.options;
    const ids = opts.filter((o) => o.label === 'id');
    expect(ids.map((o) => o.detail)).toEqual(['u · INTEGER', 'p · INTEGER']);
    expect(labels(r)).not.toContain('IF'); // not a valid keyword here
  });

  it('falls back to all columns when there is no FROM yet', () => {
    const r = complete('SELECT em|');
    const email = r.options.find((o) => o.label === 'email');
    expect(email.detail).toContain('users');
  });

  it('synthesizes FK join conditions after ON', () => {
    const r = complete('SELECT * FROM users u JOIN posts p ON |', true);
    expect(labels(r)[0]).toBe('p.user_id = u.id');
  });

  it('UPDATE ... SET only offers that table', () => {
    expect(labels(complete('UPDATE posts SET t|'))).toEqual(['title']);
  });

  it('INSERT column list', () => {
    expect(labels(complete('INSERT INTO users (e|'))).toEqual(['email']);
  });

  it('keywords follow typed case', () => {
    const upper = complete('SELECT * FROM users wh|');
    expect(upper.options.find((o) => o.label === 'WHERE').apply).toBe('where');
    const mixed = complete('SELECT * FROM users Wh|');
    expect(mixed.options.find((o) => o.label === 'WHERE').apply).toBe('WHERE');
  });

  it('functions insert an opening paren', () => {
    const r = complete('SELECT cou| FROM users');
    const c = r.options.find((o) => o.label === 'count');
    expect(c.apply).toBe('count(');
    expect(c.detail).toBe('(X | *)');
  });

  it('pragma names and values', () => {
    expect(labels(complete('PRAGMA jour|'))).toEqual(['journal_mode', 'journal_size_limit']);
    expect(labels(complete('PRAGMA journal_mode = w|'))).toEqual(['WAL']);
  });

  it('fuzzy fallback when prefix has too few hits', () => {
    expect(labels(complete('SELECT * FROM rnt|'))).toContain('remote_notes');
  });

  it('uses only the statement containing the cursor', () => {
    const r = complete('SELECT * FROM posts;\nSELECT * FROM users u WHERE u.|');
    expect(labels(r)).toEqual(['*', 'email', 'id', 'role']);
  });

  it('returns nothing inside strings', () => {
    expect(complete("SELECT 'us|' FROM users")).toBeNull();
  });
});

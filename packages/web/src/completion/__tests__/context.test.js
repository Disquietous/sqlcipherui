import { describe, it, expect } from 'vitest';
import { analyze } from '../context';

/** `|` marks the cursor. */
function at(sql) {
  const pos = sql.indexOf('|');
  return analyze(sql.replace('|', ''), pos);
}

describe('analyze: statement level', () => {
  it('statement start', () => {
    expect(at('|').kind).toBe('start');
    expect(at('SELECT 1; |').kind).toBe('start');
    expect(at('sel|').kind).toBe('start');
  });
  it('nothing inside strings and comments', () => {
    expect(at("SELECT 'ab|c' FROM t").kind).toBe('none');
    expect(at('SELECT 1 -- com|ment').kind).toBe('none');
    expect(at('SELECT /* x | y */ 1').kind).toBe('none');
  });
});

describe('analyze: tables', () => {
  it('after FROM / JOIN / INTO / UPDATE / DELETE FROM', () => {
    expect(at('SELECT * FROM |').kind).toBe('tables');
    expect(at('SELECT * FROM us|').kind).toBe('tables');
    expect(at('SELECT * FROM users JOIN |').kind).toBe('tables');
    expect(at('INSERT INTO |').kind).toBe('tables');
    expect(at('UPDATE |').kind).toBe('tables');
    expect(at('DELETE FROM |').kind).toBe('tables');
    expect(at('SELECT * FROM users, |').kind).toBe('tables');
  });
  it('after a table ref offers clause keywords', () => {
    const r = at('SELECT * FROM users |');
    expect(r.kind).toBe('keywords');
    expect(r.keywords).toContain('WHERE');
    expect(r.keywords).toContain('LEFT JOIN');
  });
  it('drop / alter targets', () => {
    expect(at('DROP TABLE |').kind).toBe('tables');
    expect(at('DROP TABLE IF EXISTS |').kind).toBe('tables');
    expect(at('DROP VIEW |').kind).toBe('views');
    expect(at('DROP INDEX |').kind).toBe('indexes');
    expect(at('DROP TRIGGER |').kind).toBe('triggers');
    expect(at('ALTER TABLE |').kind).toBe('tables');
    expect(at('CREATE TABLE |').kind).toBe('keywords'); // new name: only IF NOT EXISTS
    expect(at('CREATE INDEX i ON |').kind).toBe('tables');
    expect(at('CREATE TRIGGER t AFTER INSERT ON |').kind).toBe('tables');
  });
});

describe('analyze: columns and scope', () => {
  it('collects FROM/JOIN refs with aliases', () => {
    const r = at('SELECT | FROM users u JOIN posts AS p ON p.user_id = u.id');
    expect(r.kind).toBe('columns');
    expect(r.scope.refs.map((x) => [x.name, x.alias])).toEqual([['users', 'u'], ['posts', 'p']]);
    expect(r.scope.byName.get('u').name).toBe('users');
  });
  it('qualified: alias / table / schema', () => {
    let r = at('SELECT u.| FROM users u');
    expect(r.kind).toBe('qualified');
    expect(r.qualifier).toEqual({ name: 'u' });
    r = at('SELECT * FROM users WHERE users.em|');
    expect(r.qualifier).toEqual({ name: 'users' });
    r = at('SELECT * FROM aux.|');
    expect(r.qualifier).toEqual({ name: 'aux' });
    r = at('SELECT main.users.| FROM main.users');
    expect(r.qualifier).toEqual({ schema: 'main', name: 'users' });
  });
  it('WHERE / AND / operators / ORDER BY are column contexts', () => {
    expect(at('SELECT * FROM users WHERE |').kind).toBe('columns');
    expect(at('SELECT * FROM users WHERE id = 1 AND |').kind).toBe('columns');
    expect(at('SELECT * FROM users WHERE id = |').kind).toBe('columns');
    expect(at('SELECT * FROM users ORDER BY |').kind).toBe('columns');
    expect(at('SELECT * FROM users GROUP BY |').kind).toBe('columns');
    expect(at('SELECT id, | FROM users').kind).toBe('columns');
    expect(at('SELECT count(|) FROM users').kind).toBe('columns');
  });
  it('after column in ORDER BY offers ASC/DESC', () => {
    const r = at('SELECT * FROM users ORDER BY id |');
    expect(r.kind).toBe('keywords');
    expect(r.keywords).toContain('DESC');
  });
  it('JOIN ... ON is a joinOn context', () => {
    const r = at('SELECT * FROM users u JOIN posts p ON |');
    expect(r.kind).toBe('joinOn');
    expect(r.scope.refs).toHaveLength(2);
  });
  it('UPDATE ... SET targets that table', () => {
    const r = at('UPDATE users SET |');
    expect(r.kind).toBe('columnsOf');
    expect(r.target).toBe('users');
    expect(at('UPDATE users SET email = 1, |').target).toBe('users');
    expect(at('UPDATE users SET email |').keywords).toEqual(['=']);
  });
  it('INSERT column list and VALUES', () => {
    let r = at('INSERT INTO users (|');
    expect(r.kind).toBe('columnsOf');
    expect(r.target).toBe('users');
    r = at('INSERT INTO users (id, |');
    expect(r.kind).toBe('columnsOf');
    r = at('INSERT INTO users (id) |');
    expect(r.keywords).toContain('VALUES (');
    r = at('INSERT INTO users (id) VALUES (|');
    expect(r.kind).toBe('exprNoColumns');
    r = at('INSERT INTO users (id) VALUES (1) |');
    expect(r.keywords).toContain('RETURNING');
  });
  it('CTEs are in scope with derived columns', () => {
    const r = at('WITH recent AS (SELECT id, title AS t FROM posts) SELECT | FROM recent');
    const cte = r.scope.refs.find((x) => x.kind === 'cte');
    expect(cte.name).toBe('recent');
    expect(cte.columns).toEqual(['id', 't']);
  });
  it('subquery in FROM yields alias with derived columns', () => {
    const r = at('SELECT | FROM (SELECT id, email FROM users) AS sub');
    const sub = r.scope.refs.find((x) => x.kind === 'subquery');
    expect(sub.alias).toBe('sub');
    expect(sub.columns).toEqual(['id', 'email']);
  });
  it('subquery inside parentheses starts a fresh statement context', () => {
    const r = at('SELECT * FROM users WHERE id IN (|');
    expect(r.kind).toBe('columns');
    expect(r.keywords).toContain('SELECT');
    expect(at('SELECT * FROM users WHERE id IN (SELECT user_id FROM |').kind).toBe('tables');
  });
  it('trigger bodies see NEW/OLD via ON table', () => {
    const r = at('CREATE TRIGGER t AFTER INSERT ON posts BEGIN UPDATE users SET role = NEW.| ; END');
    expect(r.kind).toBe('qualified');
    expect(r.scope.byName.get('new').name).toBe('posts');
  });
});

describe('analyze: DDL', () => {
  it('CREATE TABLE column definitions', () => {
    let r = at('CREATE TABLE t (|');
    expect(r.kind).toBe('keywords');
    expect(r.keywords).toContain('PRIMARY KEY (');
    r = at('CREATE TABLE t (id |');
    expect(r.kind).toBe('types');
    expect(r.keywords).toContain('PRIMARY KEY');
    r = at('CREATE TABLE t (id INTEGER |');
    expect(r.kind).toBe('keywords');
    expect(r.keywords).toContain('NOT NULL');
    r = at('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT REFERENCES |');
    expect(r.kind).toBe('tables');
    r = at('CREATE TABLE t (id INTEGER, name TEXT, PRIMARY KEY (|');
    expect(r.kind).toBe('columnsOf');
    expect(r.localColumns).toEqual(['id', 'name']);
    r = at('CREATE TABLE t (id INTEGER) |');
    expect(r.keywords).toEqual(['WITHOUT ROWID', 'STRICT']);
  });
  it('ALTER TABLE', () => {
    let r = at('ALTER TABLE users |');
    expect(r.keywords).toContain('ADD COLUMN');
    r = at('ALTER TABLE users DROP COLUMN |');
    expect(r.kind).toBe('columnsOf');
    expect(r.target).toBe('users');
    r = at('ALTER TABLE users RENAME COLUMN |');
    expect(r.target).toBe('users');
    r = at('ALTER TABLE users ADD COLUMN nick |');
    expect(r.kind).toBe('types');
  });
  it('CREATE VIEW ... AS', () => {
    expect(at('CREATE VIEW v AS |').keywords).toEqual(['SELECT', 'WITH']);
    expect(at('CREATE VIEW v AS SELECT * FROM |').kind).toBe('tables');
  });
});

describe('analyze: PRAGMA', () => {
  it('names and values', () => {
    expect(at('PRAGMA |').kind).toBe('pragmaName');
    expect(at('PRAGMA jour|').kind).toBe('pragmaName');
    let r = at('PRAGMA journal_mode = |');
    expect(r.kind).toBe('pragmaValue');
    expect(r.target).toBe('journal_mode');
    r = at('PRAGMA table_info(|');
    expect(r.kind).toBe('pragmaValue');
    expect(r.target).toBe('table_info');
    expect(at('PRAGMA journal_mode |').keywords).toEqual(['=']);
  });
});

describe('analyze: CAST', () => {
  it('offers types after AS inside CAST', () => {
    expect(at('SELECT CAST(id AS |) FROM users').kind).toBe('types');
  });
});

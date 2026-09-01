/**
 * Performance budget check for the completion path on a large synthetic schema.
 * Run: npm run bench   (from packages/web)
 */
import { it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { sql, SQLite } from '@codemirror/lang-sql';
import { buildIndex } from '../index';
import { sqlCompletionSource } from '../source';

const TABLES = 500, COLS = 20;
const BUILD_BUDGET_MS = 20, CALL_BUDGET_MS = 2;

function syntheticSnapshot() {
  const snap = { schema_version: 1, schemas: ['main'], tables: [], indexes: [], triggers: [], foreign_keys: [] };
  for (let t = 0; t < TABLES; t++) {
    const name = `table_${t.toString(36)}_${['orders', 'users', 'items', 'events', 'logs'][t % 5]}`;
    const columns = [];
    for (let c = 0; c < COLS; c++) {
      columns.push({ name: c === 0 ? 'id' : `col_${c}_${['name', 'value', 'created_at', 'status'][c % 4]}`, type: 'TEXT', pk: c === 0, notnull: false, hidden: 0 });
    }
    snap.tables.push({ name, schema_name: 'main', kind: 'table', columns });
    if (t > 0) snap.foreign_keys.push({ from_table: name, from_column: 'col_1_value', to_table: snap.tables[t - 1].name, to_column: 'id' });
  }
  return snap;
}

const CASES = [
  'SELECT * FROM tab|',
  'SELECT * FROM table_1_users u JOIN table_2_items o ON |',
  'SELECT u.| FROM table_1_users u',
  'SELECT col| FROM table_1_users u JOIN table_2_items o',
  'SELECT c|',
  'UPDATE table_1_users SET col|',
];
// Pad the document with many other statements so per-call cost is provably statement-bounded.
const padding = Array.from({ length: 2000 }, (_, i) => `SELECT id, col_1_value FROM table_${i.toString(36)}_logs WHERE id = ${i};`).join('\n') + '\n';

it(`completion stays within budget on ${TABLES}×${COLS} schema`, () => {
  const t0 = performance.now();
  const index = buildIndex(syntheticSnapshot());
  const buildMs = performance.now() - t0;
  const source = sqlCompletionSource(() => index);

  const lines = [`buildIndex: ${buildMs.toFixed(2)} ms (budget ${BUILD_BUDGET_MS} ms)`];
  let worst = 0;
  for (const c of CASES) {
    const pos = padding.length + c.indexOf('|');
    const state = EditorState.create({ doc: padding + c.replace('|', ''), extensions: [sql({ dialect: SQLite })] });
    const ctx = new CompletionContext(state, pos, true);
    source(ctx); // warm-up
    const times = [];
    for (let i = 0; i < 200; i++) {
      const s = performance.now();
      source(ctx);
      times.push(performance.now() - s);
    }
    times.sort((a, b) => a - b);
    const p50 = times[100], p95 = times[190];
    worst = Math.max(worst, p95);
    lines.push(`${c.padEnd(60)} p50 ${p50.toFixed(3)} ms  p95 ${p95.toFixed(3)} ms  (${(source(ctx) || { options: [] }).options.length} options)`);
  }
  lines.push(`worst p95: ${worst.toFixed(3)} ms (budget ${CALL_BUDGET_MS} ms)`);
  console.log(lines.join('\n'));

  expect(buildMs).toBeLessThan(BUILD_BUDGET_MS);
  expect(worst).toBeLessThan(CALL_BUDGET_MS);
});

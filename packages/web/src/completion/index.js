/**
 * Builds the immutable in-memory completion index from a backend
 * SchemaSnapshot. Built once per schema version; every lookup afterwards is a
 * Map get or a binary-search prefix range (see sorted.js).
 */
import { sortByKey } from './sorted';

const lower = (s) => s.toLowerCase();

export function buildIndex(snapshot) {
  const objects = [];              // tables + views (all schemas)
  const objectsByKey = new Map();  // 'name' and 'schema.name' -> object
  const columnsByOwner = new Map();// lower object name -> sorted columns
  const columnsAgg = new Map();    // lower column name -> { key, label, owners[] }
  const schemas = [];
  const schemaSet = new Set();
  const tablesBySchema = new Map();

  for (const s of snapshot.schemas || []) {
    const key = lower(s);
    if (schemaSet.has(key)) continue;
    schemaSet.add(key);
    schemas.push({ key, label: s, kind: 'schema' });
    tablesBySchema.set(key, []);
  }

  for (const t of snapshot.tables || []) {
    const schema = t.schema_name || 'main';
    const cols = t.columns.map((c) => ({
      key: lower(c.name),
      label: c.name,
      kind: 'column',
      type: c.type || '',
      pk: !!c.pk,
      notnull: !!c.notnull,
      hidden: c.hidden || 0,
      owner: t.name,
    }));
    sortByKey(cols);
    const obj = {
      key: lower(t.name),
      label: t.name,
      kind: t.kind === 'view' ? 'view' : 'table',
      schema,
      columns: cols,
      withoutRowid: !!t.without_rowid,
      strict: !!t.strict,
    };
    objects.push(obj);
    const qualified = `${lower(schema)}.${obj.key}`;
    objectsByKey.set(qualified, obj);
    // Unqualified lookup prefers main, then first seen.
    if (!objectsByKey.has(obj.key) || schema === 'main') objectsByKey.set(obj.key, obj);
    if (!columnsByOwner.has(obj.key) || schema === 'main') columnsByOwner.set(obj.key, cols);
    columnsByOwner.set(qualified, cols);
    if (!tablesBySchema.has(lower(schema))) tablesBySchema.set(lower(schema), []);
    tablesBySchema.get(lower(schema)).push(obj);

    for (const c of cols) {
      let agg = columnsAgg.get(c.key);
      if (!agg) {
        agg = { key: c.key, label: c.label, kind: 'column', owners: [], type: c.type };
        columnsAgg.set(c.key, agg);
      }
      agg.owners.push(t.name);
    }
  }
  sortByKey(objects);
  for (const list of tablesBySchema.values()) sortByKey(list);

  const allColumns = sortByKey([...columnsAgg.values()]);

  const fkByFrom = new Map();
  const fkByTo = new Map();
  for (const fk of snapshot.foreign_keys || []) {
    const f = lower(fk.from_table), t = lower(fk.to_table);
    if (!fkByFrom.has(f)) fkByFrom.set(f, []);
    fkByFrom.get(f).push(fk);
    if (!fkByTo.has(t)) fkByTo.set(t, []);
    fkByTo.get(t).push(fk);
  }

  const indexes = sortByKey((snapshot.indexes || []).map((i) => ({ key: lower(i.name), label: i.name, kind: 'index', table: i.table })));
  const triggers = sortByKey((snapshot.triggers || []).map((i) => ({ key: lower(i.name), label: i.name, kind: 'trigger', table: i.table })));

  return {
    version: snapshot.schema_version,
    schemas,
    schemaSet,
    objects,
    objectsByKey,
    tablesBySchema,
    columnsByOwner,
    allColumns,
    fkByFrom,
    fkByTo,
    indexes,
    triggers,
  };
}

/** Empty index used when no snapshot is available (locked / loading). */
export const EMPTY_INDEX = buildIndex({ schema_version: 0, schemas: [], tables: [], indexes: [], triggers: [], foreign_keys: [] });

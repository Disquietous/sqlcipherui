/**
 * CodeMirror CompletionSource for SQLite. Combines the cursor context
 * (context.js) with the in-memory schema index (index.js).
 *
 * Per-keystroke cost: one statement tokenize + a handful of binary-search
 * prefix ranges. CodeMirror re-filters our last result client-side while the
 * user keeps typing identifier characters (`validFor`), so this source is only
 * called again when the word boundary changes.
 */
import { syntaxTree } from '@codemirror/language';
import { analyze } from './context';
import { EMPTY_INDEX } from './index';
import { fuzzyFilter } from './fuzzy';
import { prefixSlice, sortByKey } from './sorted';
import { FUNCTIONS, PRAGMAS, TYPES } from './sqlite-grammar';

const MAX_SCHEMA = 200;   // cap on schema-derived options when prefix is empty
const FUZZY_MIN = 3;      // fall back to fuzzy when prefix yields fewer than this

const FUNCTION_LIST = sortByKey(Object.keys(FUNCTIONS).map((name) => ({ key: name, label: name, kind: 'function', sig: FUNCTIONS[name] })));
const PRAGMA_LIST = sortByKey(Object.keys(PRAGMAS).map((name) => ({ key: name, label: name, kind: 'pragma' })));
const TYPE_LIST = sortByKey(TYPES.map((t) => ({ key: t.toLowerCase(), label: t, kind: 'type' })));

const WORD_RE = /[\w$]*$/;
const VALID_FOR = /^[\w$]*$/;

// ---------------------------------------------------------------------------
// Statement bounds

function statementRange(state, pos) {
  const tree = syntaxTree(state);
  let node = tree.resolveInner(pos, -1);
  while (node && node.name !== 'Statement' && node.parent) node = node.parent;
  if (node && node.name === 'Statement') {
    // Extend to the cursor when the cursor sits in trailing whitespace of an unterminated statement.
    const to = pos > node.to && !/;\s*$/.test(state.sliceDoc(node.from, node.to)) && /^\s*$/.test(state.sliceDoc(node.to, pos)) ? pos : Math.max(node.to, pos);
    return { from: node.from, to };
  }
  // Cursor is outside any statement (whitespace after one). Use the previous statement if unterminated.
  let prevStmt = null;
  for (let c = tree.topNode.firstChild; c; c = c.nextSibling) {
    if (c.name === 'Statement' && c.to <= pos) prevStmt = c;
    if (c.from > pos) break;
  }
  if (prevStmt && /^\s*$/.test(state.sliceDoc(prevStmt.to, pos)) && !/;\s*$/.test(state.sliceDoc(prevStmt.from, prevStmt.to))) {
    return { from: prevStmt.from, to: pos };
  }
  return { from: pos, to: pos };
}

// ---------------------------------------------------------------------------
// Option builders

function caseMatch(label, typed) {
  // Insert lowercase keywords if the user is typing lowercase.
  if (typed && typed === typed.toLowerCase() && typed !== typed.toUpperCase()) return label.toLowerCase();
  return label;
}

function keywordOptions(keywords, prefix, typed, boost = 0) {
  const out = [];
  const seen = new Set();
  for (const kw of keywords) {
    const key = kw.toLowerCase();
    if (seen.has(key) || (prefix && !key.startsWith(prefix))) continue;
    seen.add(key);
    out.push({ label: kw, type: 'keyword', apply: caseMatch(kw, typed), boost });
  }
  return out;
}

function functionOptions(prefix, typed) {
  return prefixSlice(FUNCTION_LIST, prefix).map((f) => ({
    label: f.label,
    type: 'function',
    detail: f.sig,
    apply: caseMatch(f.label, typed) + (f.sig === '()' ? '()' : '('),
    boost: -1,
  }));
}

function typeOptions(prefix, typed) {
  return prefixSlice(TYPE_LIST, prefix).map((t) => ({ label: t.label, type: 'type', apply: caseMatch(t.label, typed), boost: 1 }));
}

function withFuzzy(list, prefix, mapFn, limit = MAX_SCHEMA) {
  let hits = prefixSlice(list, prefix, limit);
  if (hits.length < FUZZY_MIN && prefix.length >= 2) {
    const extra = fuzzyFilter(list, prefix);
    const seen = new Set(hits);
    for (const e of extra) if (!seen.has(e)) hits.push(e);
  }
  return hits.map(mapFn);
}

function objectOption(obj, boost = 0) {
  return {
    label: obj.label,
    type: obj.kind === 'view' ? 'interface' : 'class',
    detail: obj.schema && obj.schema !== 'main' ? `${obj.schema} · ${obj.kind}` : obj.kind,
    boost,
  };
}

function columnOption(col, ownerLabel, boost) {
  return {
    label: col.label,
    type: col.pk ? 'property' : 'variable',
    detail: [ownerLabel, col.type].filter(Boolean).join(' · '),
    boost,
  };
}

function tableOptions(index, scope, prefix, extraKeywords, typed) {
  const opts = [];
  for (const ref of scope.refs) {
    if (ref.kind === 'cte' && ref.name && (!prefix || ref.name.startsWith(prefix))) opts.push({ label: ref.name, type: 'class', detail: 'cte', boost: 2 });
  }
  opts.push(...withFuzzy(index.objects, prefix, (o) => objectOption(o, 1)));
  if (index.schemas.length > 1) opts.push(...prefixSlice(index.schemas, prefix).map((s) => ({ label: s.label, type: 'namespace', detail: 'schema', boost: -1 })));
  opts.push(...keywordOptions(extraKeywords, prefix, typed));
  return opts;
}

function columnsForRef(index, ref) {
  if (!ref) return null;
  if (ref.kind === 'cte' || ref.kind === 'subquery') {
    return sortByKey((ref.columns || []).map((c) => ({ key: c.toLowerCase(), label: c, kind: 'column', type: '' })));
  }
  const key = ref.schema ? `${ref.schema}.${ref.name}` : ref.name;
  return index.columnsByOwner.get(key) || index.columnsByOwner.get(ref.name) || null;
}

function scopeColumnOptions(index, scope, prefix) {
  const opts = [];
  const seen = new Set();
  const multi = scope.refs.length > 1;
  for (const ref of scope.refs) {
    const cols = columnsForRef(index, ref);
    if (!cols) continue;
    const ownerLabel = ref.alias || ref.name || 'subquery';
    for (const col of withFuzzy(cols, prefix, (c) => c)) {
      const k = `${ownerLabel}.${col.key}`;
      if (seen.has(k)) continue;
      seen.add(k);
      opts.push(columnOption(col, multi ? ownerLabel : (ref.alias || ref.name), 3 + (col.pk ? 0.5 : 0)));
    }
  }
  return opts;
}

function allColumnOptions(index, prefix) {
  return withFuzzy(index.allColumns, prefix, (c) => ({
    label: c.label,
    type: 'variable',
    detail: c.owners.length > 3 ? `${c.owners.slice(0, 3).join(', ')} +${c.owners.length - 3}` : c.owners.join(', '),
    boost: 0,
  }));
}

function columnsOfOptions(index, analysis, prefix) {
  if (analysis.localColumns && analysis.localColumns.length) {
    const list = sortByKey(analysis.localColumns.map((c) => ({ key: c.toLowerCase(), label: c, kind: 'column', type: '' })));
    return withFuzzy(list, prefix, (c) => columnOption(c, null, 3));
  }
  const target = analysis.target;
  if (!target) return [];
  const ref = analysis.scope.byName.get(target) || { name: target, kind: 'table', schema: null };
  const cols = columnsForRef(index, ref);
  if (!cols) return [];
  return withFuzzy(cols, prefix, (c) => columnOption(c, null, 3));
}

function qualifiedOptions(index, analysis, prefix) {
  const { qualifier, scope } = analysis;
  if (qualifier.schema) {
    const cols = index.columnsByOwner.get(`${qualifier.schema}.${qualifier.name}`);
    return cols ? [...withFuzzy(cols, prefix, (c) => columnOption(c, null, 3)), { label: '*', type: 'keyword', boost: 4 }] : [];
  }
  const ref = scope.byName.get(qualifier.name);
  const refCols = ref ? columnsForRef(index, ref) : null;
  if (refCols) {
    const opts = withFuzzy(refCols, prefix, (c) => columnOption(c, null, 3));
    if (!prefix) opts.unshift({ label: '*', type: 'keyword', boost: 4 });
    return opts;
  }
  if (index.schemaSet.has(qualifier.name)) {
    const list = index.tablesBySchema.get(qualifier.name) || [];
    return withFuzzy(list, prefix, (o) => objectOption(o, 1));
  }
  const cols = index.columnsByOwner.get(qualifier.name);
  if (cols) {
    const opts = withFuzzy(cols, prefix, (c) => columnOption(c, null, 3));
    if (!prefix) opts.unshift({ label: '*', type: 'keyword', boost: 4 });
    return opts;
  }
  return [];
}

function joinOnOptions(index, scope) {
  // Synthesize `a.col = b.col` from foreign keys between in-scope tables.
  const opts = [];
  const seen = new Set();
  const refs = scope.refs.filter((r) => r.kind === 'table' && r.name);
  const labelOf = (r) => r.alias || r.name;
  for (const a of refs) {
    const fks = index.fkByFrom.get(a.name) || [];
    for (const fk of fks) {
      for (const b of refs) {
        if (b === a || b.name !== fk.to_table.toLowerCase()) continue;
        const text = `${labelOf(a)}.${fk.from_column} = ${labelOf(b)}.${fk.to_column}`;
        if (seen.has(text)) continue;
        seen.add(text);
        opts.push({ label: text, type: 'text', detail: 'foreign key', boost: 5 });
      }
    }
  }
  return opts;
}

function pragmaValueOptions(name, prefix, typed) {
  const values = PRAGMAS[name] || [];
  return keywordOptions(values, prefix, typed, 2);
}

export function buildOptions(analysis, index, prefix, typed) {
  const kws = () => keywordOptions(analysis.keywords, prefix, typed);
  const fns = () => (analysis.functions ? functionOptions(prefix, typed) : []);
  switch (analysis.kind) {
    case 'none': return [];
    case 'start': return kws();
    case 'keywords': return kws();
    case 'tables': return tableOptions(index, analysis.scope, prefix, analysis.keywords, typed);
    case 'views': return [...withFuzzy(index.objects.filter((o) => o.kind === 'view'), prefix, (o) => objectOption(o, 1)), ...kws()];
    case 'indexes': return [...withFuzzy(index.indexes, prefix, (o) => ({ label: o.label, type: 'class', detail: `index on ${o.table}`, boost: 1 })), ...kws()];
    case 'triggers': return [...withFuzzy(index.triggers, prefix, (o) => ({ label: o.label, type: 'class', detail: `trigger on ${o.table}`, boost: 1 })), ...kws()];
    case 'schemas': return [...prefixSlice(index.schemas, prefix).map((s) => ({ label: s.label, type: 'namespace', detail: 'schema', boost: 1 })), ...kws()];
    case 'qualified': return qualifiedOptions(index, analysis, prefix);
    case 'columnsOf': return columnsOfOptions(index, analysis, prefix);
    case 'types': return [...typeOptions(prefix, typed), ...kws()];
    case 'pragmaName': return withFuzzy(PRAGMA_LIST, prefix, (p) => ({ label: p.label, type: 'property', boost: 1 }));
    case 'pragmaValue': return pragmaValueOptions(analysis.target, prefix, typed);
    case 'exprNoColumns': return [...kws(), ...fns()];
    case 'joinOn': {
      const opts = joinOnOptions(index, analysis.scope);
      opts.push(...scopeColumnOptions(index, analysis.scope, prefix));
      opts.push(...tableOptions(index, analysis.scope, prefix, [], typed).map((o) => ({ ...o, boost: -2 })));
      opts.push(...kws(), ...fns());
      return opts;
    }
    case 'columns': {
      const opts = analysis.scope.refs.length ? scopeColumnOptions(index, analysis.scope, prefix) : allColumnOptions(index, prefix);
      // Tables/aliases rank low so `t.` qualification remains reachable.
      for (const ref of analysis.scope.refs) {
        const l = ref.alias || ref.name;
        if (l && (!prefix || l.startsWith(prefix))) opts.push({ label: l, type: 'class', detail: ref.alias ? ref.name : ref.kind, boost: -2 });
      }
      if (!analysis.scope.refs.length) opts.push(...withFuzzy(index.objects, prefix, (o) => objectOption(o, -2), 50));
      opts.push(...kws(), ...fns());
      return opts;
    }
    default: return kws();
  }
}

/**
 * @param {() => object|null} getIndex returns the current schema index (or null)
 */
export function sqlCompletionSource(getIndex) {
  return (ctx) => {
    const word = ctx.matchBefore(WORD_RE);
    const afterDot = ctx.matchBefore(/\.[\w$]*$/);
    if (!ctx.explicit && !afterDot && (!word || word.from === word.to)) return null;
    const from = word ? word.from : ctx.pos;
    const typed = word ? word.text : '';
    const prefix = typed.toLowerCase();

    const range = statementRange(ctx.state, from);
    const text = ctx.state.sliceDoc(range.from, range.to);
    const analysis = analyze(text, from - range.from);
    if (analysis.kind === 'none') return null;

    const index = getIndex() || EMPTY_INDEX;
    const options = buildOptions(analysis, index, prefix, typed);
    if (!options.length) return null;
    return { from, options, validFor: VALID_FOR };
  };
}

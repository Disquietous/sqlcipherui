/**
 * Cursor-context analysis for SQL completion.
 *
 * `analyze(text, cursor)` tokenizes ONE statement and returns what kinds of
 * candidates make sense at the cursor plus the table scope (FROM/JOIN refs,
 * aliases, CTEs). Cost is O(statement length); never touches the network or
 * the schema index.
 *
 * Result shape:
 *   {
 *     kind: 'none' | 'start' | 'keywords' | 'tables' | 'views' | 'indexes' | 'triggers'
 *         | 'schemas' | 'qualified' | 'columns' | 'columnsOf' | 'joinOn' | 'types'
 *         | 'pragmaName' | 'pragmaValue' | 'exprNoColumns',
 *     keywords: string[],          // keyword candidates that fit here
 *     qualifier: {schema?, name} | null,   // for kind 'qualified'
 *     target: string | null,       // table for columnsOf / pragma name for pragmaValue
 *     localColumns: string[],      // columns declared so far inside CREATE TABLE (...)
 *     scope: { refs: Ref[], byName: Map<string, Ref> },
 *     functions: boolean,          // whether function candidates apply
 *   }
 *   Ref = { name, schema, alias, kind: 'table'|'cte'|'subquery', columns: string[]|null }
 */
import { NEXT_KEYWORDS, STATEMENT_START, PRAGMAS, TABLE_OPTIONS, FUNCTION_SET } from './sqlite-grammar';
import { tokenize, tokenBefore } from './tokenize';

const STMT_STARTERS = new Set([
  'select', 'insert', 'replace', 'update', 'delete', 'create', 'drop', 'alter', 'with', 'pragma',
  'explain', 'begin', 'commit', 'rollback', 'savepoint', 'release', 'attach', 'detach', 'vacuum',
  'analyze', 'reindex', 'values', 'end',
]);
const EXPR_CLAUSES = new Set([
  'where', 'on', 'having', 'set', 'when', 'then', 'else', 'returning', 'groupBy', 'orderBy',
  'partitionBy', 'select', 'check', 'default', 'filter', 'window',
]);

const isName = (tok) => tok && (tok.t === 'id' || tok.t === 'qid');
const isPunct = (tok, v) => tok && tok.t === 'punct' && tok.v === v;
const isKw = (tok, v) => tok && tok.t === 'kw' && tok.lv === v;

function newFrame(openerKind = 'stmt', openerIdx = -1, fnName = null) {
  return {
    openerKind, openerIdx, fnName,
    stmtType: null, clause: null, objType: null, alterAction: null,
    itemStart: openerIdx + 1, sawBegin: false, target: null,
  };
}

function result(kind, extra = {}) {
  return {
    kind,
    keywords: [],
    qualifier: null,
    target: null,
    localColumns: [],
    scope: { refs: [], byName: new Map() },
    functions: false,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Scope (table references, aliases, CTEs)

function matchingParen(tokens, openIdx) {
  let depth = 0;
  for (let k = openIdx; k < tokens.length; k++) {
    if (isPunct(tokens[k], '(')) depth++;
    else if (isPunct(tokens[k], ')')) { depth--; if (depth === 0) return k; }
  }
  return tokens.length - 1;
}

/** Column names produced by a SELECT list starting after `selectIdx` (same depth). */
function selectListColumns(tokens, selectIdx, endIdx) {
  const cols = [];
  let depth = 0, item = [], star = false;
  const flush = () => {
    if (!item.length) return;
    let name = null;
    for (let j = item.length - 1; j >= 0; j--) {
      if (isKw(item[j], 'as') && isName(item[j + 1])) { name = item[j + 1]; break; }
    }
    if (!name) {
      const last = item[item.length - 1];
      if (isName(last)) name = last;
      else if (item.length >= 2 && isName(item[item.length - 2]) && isKw(last, 'as')) name = null;
    }
    if (name) cols.push(name.t === 'qid' ? name.v.slice(1, -1) : name.v);
    item = [];
  };
  for (let k = selectIdx + 1; k <= endIdx; k++) {
    const tok = tokens[k];
    if (isPunct(tok, '(')) depth++;
    else if (isPunct(tok, ')')) { if (depth === 0) break; depth--; }
    if (depth === 0) {
      if (tok.t === 'kw' && (tok.lv === 'from' || tok.lv === 'where' || tok.lv === 'union' || tok.lv === 'limit' || tok.lv === 'order' || tok.lv === 'group')) break;
      if (isPunct(tok, ',')) { flush(); continue; }
      if (tok.t === 'op' && tok.v === '*' && item.length === 0) { star = true; continue; }
      if (isKw(tok, 'distinct') || isKw(tok, 'all')) continue;
    }
    item.push(tok);
  }
  flush();
  return { cols, star };
}

/** Derive output columns of a parenthesised subquery at `openIdx`. */
function subqueryColumns(tokens, openIdx, closeIdx) {
  for (let k = openIdx + 1; k < closeIdx; k++) {
    if (isKw(tokens[k], 'select')) return selectListColumns(tokens, k, closeIdx);
    if (isPunct(tokens[k], '(')) k = matchingParen(tokens, k);
  }
  return { cols: [], star: false };
}

/** Parse one table reference at `k`; returns [ref|null, nextIdx]. */
function parseRef(tokens, k) {
  const tok = tokens[k];
  if (!tok) return [null, k];
  let ref;
  if (isPunct(tok, '(')) {
    const close = matchingParen(tokens, k);
    const { cols } = subqueryColumns(tokens, k, close);
    ref = { name: null, schema: null, alias: null, kind: 'subquery', columns: cols };
    k = close + 1;
  } else if (isName(tok) || (tok.t === 'kw' && !STMT_STARTERS.has(tok.lv) && tok.lv !== 'select')) {
    let schema = null, name = tok.lv;
    k++;
    if (isPunct(tokens[k], '.')) {
      if (!isName(tokens[k + 1])) return [null, k + 1]; // `schema.` still being typed
      schema = name; name = tokens[k + 1].lv; k += 2;
    }
    if (isPunct(tokens[k], '(')) k = matchingParen(tokens, k) + 1; // table-valued function args
    ref = { name, schema, alias: null, kind: 'table', columns: null };
  } else {
    return [null, k];
  }
  if (isKw(tokens[k], 'as') && isName(tokens[k + 1])) { ref.alias = tokens[k + 1].lv; k += 2; }
  else if (isName(tokens[k])) { ref.alias = tokens[k].lv; k++; }
  if (isKw(tokens[k], 'indexed') && isKw(tokens[k + 1], 'by')) k += 3;
  else if (isKw(tokens[k], 'not') && isKw(tokens[k + 1], 'indexed')) k += 2;
  return [ref, k];
}

function collectScope(tokens) {
  const refs = [];
  const byName = new Map();
  const add = (ref) => {
    if (!ref) return;
    refs.push(ref);
    if (ref.alias) byName.set(ref.alias, ref);
    if (ref.name && !byName.has(ref.name)) byName.set(ref.name, ref);
  };

  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    if (tok.t !== 'kw') continue;
    if (tok.lv === 'with') {
      // WITH [RECURSIVE] name [(cols)] AS [NOT] [MATERIALIZED] ( ... ) [, name AS (...)]*
      let j = k + 1;
      if (isKw(tokens[j], 'recursive')) j++;
      while (isName(tokens[j])) {
        const cte = { name: tokens[j].lv, schema: null, alias: null, kind: 'cte', columns: [] };
        j++;
        if (isPunct(tokens[j], '(')) {
          const close = matchingParen(tokens, j);
          for (let c = j + 1; c < close; c++) if (isName(tokens[c])) cte.columns.push(tokens[c].v);
          j = close + 1;
        }
        if (!isKw(tokens[j], 'as')) break;
        j++;
        while (tokens[j] && tokens[j].t === 'kw' && (tokens[j].lv === 'not' || tokens[j].lv === 'materialized')) j++;
        if (!isPunct(tokens[j], '(')) break;
        const close = matchingParen(tokens, j);
        if (!cte.columns.length) cte.columns = subqueryColumns(tokens, j, close).cols;
        add(cte);
        j = close + 1;
        if (!isPunct(tokens[j], ',')) break;
        j++;
      }
    } else if (tok.lv === 'from' || tok.lv === 'join' || tok.lv === 'update' || tok.lv === 'into') {
      if (tok.lv === 'update' && k > 0 && isKw(tokens[k - 1], 'of')) continue; // trigger UPDATE OF
      let j = k + 1;
      if (tok.lv === 'update' && isKw(tokens[j], 'or')) j += 2;
      for (;;) {
        const [ref, next] = parseRef(tokens, j);
        if (!ref) break;
        add(ref);
        j = next;
        if (tok.lv === 'from' && isPunct(tokens[j], ',')) { j++; continue; }
        break;
      }
    } else if (tok.lv === 'on' && k > 0) {
      // CREATE INDEX/TRIGGER ... ON table  → make the table visible (NEW./OLD. too)
      let hasCreate = false;
      for (let j = k - 1; j >= 0 && j >= k - 12; j--) if (isKw(tokens[j], 'create')) { hasCreate = true; break; }
      if (hasCreate) {
        const [ref] = parseRef(tokens, k + 1);
        if (ref && ref.kind === 'table') { ref.alias = null; add(ref); byName.set('new', ref); byName.set('old', ref); }
      }
    }
  }
  return { refs, byName };
}

// ---------------------------------------------------------------------------
// Frame walk (tracks paren nesting + clause state up to the cursor)

function classifyParen(tokens, k, frame) {
  const prev = tokens[k - 1], prev2 = tokens[k - 2], prev3 = tokens[k - 3];
  if (!prev) return ['expr', null];
  if (prev.t === 'kw') {
    switch (prev.lv) {
      case 'values': return ['values', null];
      case 'using': return ['using', null];
      case 'in': return ['in', null];
      case 'key': return ['constraintCols', null];   // PRIMARY KEY ( / FOREIGN KEY (
      case 'unique': return frame.openerKind === 'createCols' ? ['constraintCols', null] : ['expr', null];
      case 'check': return ['expr', null];
      case 'as': return frame.stmtType === 'with' || frame.clause === 'with' ? ['cte', null] : ['expr', null];
      case 'conflict': return ['conflictCols', null];
      case 'exists': return ['expr', null];
      case 'cast': return ['fn', 'cast'];
      default: return ['expr', null];
    }
  }
  if (isName(prev)) {
    if (isKw(prev2, 'into') || (isKw(prev2, 'as') && isName(prev3) && isKw(tokens[k - 4], 'into'))) {
      return ['insertCols', isKw(prev2, 'into') ? prev.lv : prev3.lv];
    }
    if (frame.stmtType === 'create' && frame.objType === 'table' && !frame.sawBegin) return ['createCols', prev.lv];
    if (frame.stmtType === 'create' && frame.objType === 'index' && isKw(prev2, 'on')) return ['indexCols', prev.lv];
    if (isKw(prev2, 'references')) return ['refCols', prev.lv];
    if (frame.clause === 'with' || frame.stmtType === 'with') {
      // WITH name ( cols ) — only if followed later by AS; treat as cte column list
      if (isKw(tokens[k - 2], 'with') || isKw(tokens[k - 2], 'recursive') || isPunct(tokens[k - 2], ',')) return ['cteCols', prev.lv];
    }
    if (frame.stmtType === 'pragma') return ['pragmaArgs', prev.lv];
    return ['fn', prev.lv];
  }
  return ['expr', null];
}

function walkFrames(tokens, endIdx) {
  const stack = [newFrame()];
  for (let k = 0; k <= endIdx; k++) {
    const tok = tokens[k];
    let f = stack[stack.length - 1];
    if (tok.t === 'punct') {
      if (tok.v === '(') {
        const [kind, name] = classifyParen(tokens, k, f);
        const nf = newFrame(kind, k, name);
        if (kind === 'createCols' || kind === 'insertCols' || kind === 'indexCols' || kind === 'refCols' || kind === 'pragmaArgs') nf.target = name;
        if (kind === 'constraintCols' || kind === 'conflictCols') nf.target = f.target;
        stack.push(nf);
      } else if (tok.v === ')') {
        if (stack.length > 1) stack.pop();
      } else if (tok.v === ',') {
        f.itemStart = k + 1;
      } else if (tok.v === ';') {
        stack.length = 0;
        stack.push(newFrame());
      }
      continue;
    }
    if (tok.t !== 'kw') continue;
    const kw = tok.lv;
    if (!f.stmtType && STMT_STARTERS.has(kw)) {
      f.stmtType = kw === 'replace' ? 'insert' : kw;
      if (kw === 'select') f.clause = 'select';
      if (kw === 'with') f.clause = 'with';
      if (kw === 'pragma') f.clause = 'pragma';
      continue;
    }
    switch (kw) {
      case 'select': f.clause = 'select'; if (f.stmtType === 'with' || f.stmtType === 'create' || f.stmtType === 'insert') f.stmtType = f.stmtType === 'with' ? 'select' : f.stmtType; break;
      case 'from': f.clause = 'from'; break;
      case 'join': f.clause = 'join'; break;
      case 'where': f.clause = 'where'; break;
      case 'on': f.clause = 'on'; break;
      case 'using': f.clause = 'using'; break;
      case 'having': f.clause = 'having'; break;
      case 'limit': f.clause = 'limit'; break;
      case 'offset': f.clause = 'offset'; break;
      case 'set': f.clause = 'set'; break;
      case 'into': f.clause = 'into'; break;
      case 'values': f.clause = 'values'; break;
      case 'returning': f.clause = 'returning'; break;
      case 'window': f.clause = 'window'; break;
      case 'by':
        if (isKw(tokens[k - 1], 'group')) f.clause = 'groupBy';
        else if (isKw(tokens[k - 1], 'order')) f.clause = 'orderBy';
        else if (isKw(tokens[k - 1], 'partition')) f.clause = 'partitionBy';
        break;
      case 'when': case 'then': case 'else': f.clause = kw; break;
      case 'union': case 'intersect': case 'except': f.clause = 'compound'; break;
      case 'table': case 'view': case 'index': case 'trigger':
        if (f.stmtType === 'create' || f.stmtType === 'drop' || f.stmtType === 'alter') { f.objType = kw; f.clause = kw; }
        break;
      case 'add': case 'drop': case 'rename':
        if (f.stmtType === 'alter') { f.alterAction = kw; f.clause = 'alterAction'; }
        break;
      case 'column': if (f.stmtType === 'alter') f.clause = 'alterColumn'; break;
      case 'begin': if (f.stmtType === 'create') { f.sawBegin = true; f.clause = 'triggerBody'; } break;
      case 'end': if (f.stmtType === 'create') f.clause = 'triggerEnd'; break;
      case 'insert': case 'update': case 'delete':
        if (f.stmtType === 'create' && f.objType === 'trigger' && !f.sawBegin) f.clause = 'triggerEvent';
        break;
      case 'check': f.clause = 'check'; break;
      case 'default': if (f.openerKind === 'createCols' || f.clause === 'alterColumn') f.clause = 'default'; break;
      case 'references': f.clause = 'references'; break;
      case 'collate': f.clause = 'collate'; break;
      default: break;
    }
  }
  return stack;
}

// ---------------------------------------------------------------------------

function localColumnsOf(tokens, frame, endIdx) {
  // First identifier of each comma-separated item directly inside CREATE TABLE ( ... )
  const cols = [];
  let depth = 0, expectName = true;
  for (let k = frame.openerIdx + 1; k <= endIdx; k++) {
    const tok = tokens[k];
    if (isPunct(tok, '(')) { depth++; continue; }
    if (isPunct(tok, ')')) { depth--; continue; }
    if (depth) continue;
    if (isPunct(tok, ',')) { expectName = true; continue; }
    if (expectName) {
      expectName = false;
      if (isName(tok)) cols.push(tok.t === 'qid' ? tok.v.slice(1, -1) : tok.v);
    }
  }
  return cols;
}

function kwResult(state, extra = {}) {
  return result('keywords', { keywords: NEXT_KEYWORDS[state] || [], ...extra });
}

function exprResult(extraKeywords = [], extra = {}) {
  return result('columns', { keywords: [...NEXT_KEYWORDS.expr, ...extraKeywords], functions: true, ...extra });
}

/**
 * Analyse the statement text with the cursor at `cursor` (offset into `text`,
 * positioned at the START of the word being typed).
 */
export function analyze(text, cursor) {
  const tokens = tokenize(text);
  const scope = collectScope(tokens);
  const withScope = (r) => { r.scope = scope; return r; };

  let i = tokenBefore(tokens, cursor);
  // Cursor inside a string / comment / quoted identifier that started earlier → nothing.
  const containing = tokens[i + 1];
  if (containing && containing.from < cursor && (containing.t === 'str' || containing.t === 'comment')) return withScope(result('none'));
  if (containing && containing.from < cursor && containing.t === 'qid' && containing.to > cursor) return withScope(result('none'));
  if (i >= 0 && tokens[i].to === cursor && (tokens[i].t === 'id' || tokens[i].t === 'kw' || tokens[i].t === 'qid')) {
    // The token ending exactly at the cursor is the word being typed; ignore it.
    i--;
  }
  if (i >= 0 && tokens[i].t === 'comment' && tokens[i].to === cursor && !/\n$|\*\/$/.test(tokens[i].v)) return withScope(result('none'));

  if (i < 0) return withScope(result('start', { keywords: STATEMENT_START }));
  const prev = tokens[i];
  if (isPunct(prev, ';')) return withScope(result('start', { keywords: STATEMENT_START }));

  const stack = walkFrames(tokens, i);
  const f = stack[stack.length - 1];
  const parent = stack.length > 1 ? stack[stack.length - 2] : null;
  const stmt = f.stmtType || (parent && parent.stmtType);

  // --- Qualified reference: `x.` / `schema.table.` ---
  if (isPunct(prev, '.')) {
    const q1 = tokens[i - 1];
    if (!q1 || !(isName(q1) || q1.t === 'kw')) return withScope(result('none'));
    if (stmt === 'pragma' && f.openerKind === 'stmt') return withScope(result('pragmaName', { target: q1.lv }));
    let qualifier = { name: q1.lv };
    if (isPunct(tokens[i - 2], '.') && isName(tokens[i - 3])) qualifier = { schema: tokens[i - 3].lv, name: q1.lv };
    return withScope(result('qualified', { qualifier }));
  }

  // --- PRAGMA statements ---
  if (stmt === 'pragma') {
    if (f.openerKind === 'pragmaArgs') return withScope(result('pragmaValue', { target: f.fnName }));
    if (isKw(prev, 'pragma')) return withScope(result('pragmaName'));
    if (isName(prev) && (isKw(tokens[i - 1], 'pragma') || isPunct(tokens[i - 1], '.'))) return withScope(kwResult('pragmaAfterName'));
    if (prev.t === 'op' && prev.v === '=') {
      const name = tokens[i - 1];
      return withScope(result('pragmaValue', { target: isName(name) ? name.lv : null }));
    }
    return withScope(result('none'));
  }

  // --- Inside special parentheses ---
  const atItemStart = isPunct(prev, '(') || isPunct(prev, ',');
  switch (f.openerKind) {
    case 'insertCols':
      return withScope(atItemStart ? result('columnsOf', { target: f.target }) : result('none'));
    case 'indexCols':
    case 'refCols':
      return withScope(atItemStart ? result('columnsOf', { target: f.target }) : kwResult('orderBy'));
    case 'constraintCols':
    case 'conflictCols': {
      const local = parent && parent.openerKind === 'createCols' ? localColumnsOf(tokens, parent, parent.openerIdx === -1 ? i : i) : [];
      if (atItemStart) {
        if (local.length) return withScope(result('columnsOf', { target: null, localColumns: local }));
        if (f.openerKind === 'conflictCols' && f.target) return withScope(result('columnsOf', { target: f.target }));
        return withScope(result('columns', { functions: false }));
      }
      return withScope(kwResult('orderBy'));
    }
    case 'cteCols':
      return withScope(result('none'));
    case 'using':
      return withScope(atItemStart ? result('columns', { functions: false }) : result('none'));
    case 'values':
      return withScope(result('exprNoColumns', { keywords: NEXT_KEYWORDS.values, functions: true }));
    case 'createCols': {
      const local = localColumnsOf(tokens, f, i);
      const itemTokens = i - f.itemStart + 1; // tokens typed in the current column definition
      if (atItemStart) return withScope(result('keywords', { keywords: NEXT_KEYWORDS.tableConstraint, localColumns: local }));
      if (itemTokens === 1 && isName(prev)) return withScope(result('types', { keywords: NEXT_KEYWORDS.columnConstraint, localColumns: local }));
      if (prev.t === 'kw') {
        switch (prev.lv) {
          case 'references': return withScope(result('tables', { localColumns: local }));
          case 'collate': return withScope(kwResult('collate'));
          case 'conflict': return withScope(kwResult('conflict'));
          case 'default': return withScope(result('exprNoColumns', { keywords: NEXT_KEYWORDS.values, functions: true }));
          case 'primary': case 'foreign': return withScope(result('keywords', { keywords: ['KEY'] }));
          case 'not': return withScope(result('keywords', { keywords: ['NULL'] }));
          case 'on': return withScope(result('keywords', { keywords: ['CONFLICT', 'DELETE', 'UPDATE'] }));
          case 'delete': case 'update': return withScope(result('keywords', { keywords: ['CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT', 'NO ACTION'] }));
          case 'generated': return withScope(result('keywords', { keywords: ['ALWAYS AS ('] }));
          case 'always': return withScope(result('keywords', { keywords: ['AS ('] }));
          case 'as': case 'check': return withScope(result('keywords', { keywords: ['('] }));
          default: break;
        }
      }
      if (isPunct(prev, ')')) return withScope(result('keywords', { keywords: [...NEXT_KEYWORDS.columnConstraint, ...NEXT_KEYWORDS.fkClause], localColumns: local }));
      return withScope(result('keywords', { keywords: [...NEXT_KEYWORDS.columnConstraint, ...NEXT_KEYWORDS.fkClause], localColumns: local }));
    }
    case 'fn':
      if (f.fnName === 'cast' && isKw(prev, 'as')) return withScope(result('types'));
      if (atItemStart || prev.t === 'op' || isKw(prev, 'distinct')) return withScope(exprResult(f.fnName === 'cast' ? ['AS'] : ['DISTINCT', '*']));
      return withScope(result('keywords', { keywords: f.fnName === 'cast' ? ['AS'] : [...NEXT_KEYWORDS.expr, 'AS'] }));
    case 'in':
    case 'expr':
    case 'cte':
    case 'pragmaArgs':
      if (isPunct(prev, '(') && !f.stmtType) {
        return withScope(result('columns', { keywords: ['SELECT', 'WITH', 'VALUES', 'NOT', 'EXISTS', 'CASE', 'CAST(', 'NULL'], functions: true }));
      }
      break; // fall through to general clause handling with this frame's state
    default:
      break;
  }

  // --- Keyword just before the cursor ---
  if (prev.t === 'kw') {
    const kw = prev.lv;
    switch (kw) {
      case 'select': return withScope(result('columns', { keywords: NEXT_KEYWORDS.select, functions: true }));
      case 'distinct': case 'all':
        if (f.clause === 'select') return withScope(result('columns', { keywords: ['*'], functions: true }));
        return withScope(kwResult('expr'));
      case 'from': case 'join': case 'update': case 'into':
        if (kw === 'update' && stmt === 'create') return withScope(result('keywords', { keywords: ['OF', 'ON'] }));
        return withScope(result('tables', { keywords: kw === 'from' && stmt !== 'delete' ? ['('] : [] }));
      case 'delete': return withScope(result('keywords', { keywords: stmt === 'create' && f.objType === 'trigger' ? ['ON'] : ['FROM'] }));
      case 'insert': case 'replace':
        return withScope(stmt === 'create' && f.objType === 'trigger' ? result('keywords', { keywords: ['ON'] }) : kwResult('insert'));
      case 'or':
        if (f.clause === null || (stmt === 'insert' && f.clause !== 'where' && f.clause !== 'on') || stmt === 'update' && f.clause === null) {
          return withScope(result('keywords', { keywords: ['REPLACE', 'IGNORE', 'ABORT', 'FAIL', 'ROLLBACK'] }));
        }
        return withScope(exprResult());
      case 'table':
        if (stmt === 'alter' || stmt === 'drop') return withScope(result('tables', { keywords: stmt === 'drop' ? ['IF EXISTS'] : [] }));
        return withScope(kwResult('createTableName'));
      case 'view':
        if (stmt === 'drop') return withScope(result('views', { keywords: ['IF EXISTS'] }));
        return withScope(kwResult('createTableName'));
      case 'index':
        if (stmt === 'drop') return withScope(result('indexes', { keywords: ['IF EXISTS'] }));
        return withScope(kwResult('createTableName'));
      case 'trigger':
        if (stmt === 'drop') return withScope(result('triggers', { keywords: ['IF EXISTS'] }));
        return withScope(kwResult('createTableName'));
      case 'if': return withScope(result('keywords', { keywords: stmt === 'drop' ? ['EXISTS'] : ['NOT EXISTS'] }));
      case 'exists':
        if (stmt === 'drop') {
          if (f.objType === 'table') return withScope(result('tables'));
          if (f.objType === 'view') return withScope(result('views'));
          if (f.objType === 'index') return withScope(result('indexes'));
          if (f.objType === 'trigger') return withScope(result('triggers'));
        }
        if (stmt === 'create') return withScope(result('none'));
        return withScope(result('keywords', { keywords: ['('] }));
      case 'on':
        if (stmt === 'create' && (f.objType === 'index' || f.objType === 'trigger')) return withScope(result('tables'));
        if (stmt === 'insert' || f.openerKind === 'createCols') return withScope(result('keywords', { keywords: ['CONFLICT'] }));
        return withScope(result('joinOn', { keywords: NEXT_KEYWORDS.expr, functions: true }));
      case 'conflict': return withScope(result('keywords', { keywords: stmt === 'insert' ? ['(', 'DO NOTHING', 'DO UPDATE SET'] : NEXT_KEYWORDS.conflict }));
      case 'do': return withScope(result('keywords', { keywords: ['NOTHING', 'UPDATE SET'] }));
      case 'where': case 'and': case 'not': case 'having': case 'when': case 'then': case 'else':
      case 'case': case 'like': case 'glob': case 'between': case 'is': case 'returning':
        return withScope(exprResult(kw === 'is' ? ['NULL', 'NOT NULL', 'NOT'] : []));
      case 'in': return withScope(result('keywords', { keywords: ['(', 'SELECT'] }));
      case 'by':
        if (f.clause === 'orderBy') return withScope(result('columns', { keywords: [], functions: true }));
        if (f.clause === 'groupBy' || f.clause === 'partitionBy') return withScope(result('columns', { keywords: [], functions: true }));
        return withScope(result('none'));
      case 'group': case 'order': case 'partition': return withScope(result('keywords', { keywords: ['BY'] }));
      case 'set':
        if (stmt === 'update' || stmt === 'insert') {
          const target = stmt === 'update' ? (scope.refs[0] && scope.refs[0].name) : (scope.refs[0] && scope.refs[0].name);
          return withScope(result('columnsOf', { target }));
        }
        return withScope(result('keywords', { keywords: ['NULL', 'DEFAULT'] }));
      case 'as':
        if (stmt === 'create' && f.objType === 'view') return withScope(result('keywords', { keywords: ['SELECT', 'WITH'] }));
        if (stmt === 'create' && f.objType === 'table') return withScope(result('keywords', { keywords: ['SELECT', 'WITH'] }));
        if (f.clause === 'with') return withScope(result('keywords', { keywords: ['(', 'MATERIALIZED (', 'NOT MATERIALIZED ('] }));
        return withScope(result('none'));
      case 'values': return withScope(result('keywords', { keywords: ['('] }));
      case 'union': case 'intersect': case 'except': return withScope(result('keywords', { keywords: ['SELECT', 'ALL', 'VALUES'] }));
      case 'limit': case 'offset': case 'escape': case 'to': case 'savepoint': case 'release': case 'database': case 'recursive':
        return withScope(result('none'));
      case 'collate': return withScope(kwResult('collate'));
      case 'begin': return withScope(stmt === 'begin' ? kwResult('begin') : result('start', { keywords: STATEMENT_START }));
      case 'commit': case 'rollback': return withScope(result('keywords', { keywords: ['TRANSACTION', 'TO SAVEPOINT'] }));
      case 'transaction': case 'deferred': case 'immediate': case 'exclusive': return withScope(result('keywords', { keywords: stmt === 'begin' && kw !== 'transaction' ? ['TRANSACTION'] : [] }));
      case 'end': return withScope(result('keywords', { keywords: f.clause === 'triggerEnd' ? [] : ['AS', ...NEXT_KEYWORDS.expr] }));
      case 'with': return withScope(result('keywords', { keywords: NEXT_KEYWORDS.with }));
      case 'attach': return withScope(result('keywords', { keywords: ['DATABASE'] }));
      case 'detach': return withScope(result('schemas', { keywords: ['DATABASE'] }));
      case 'explain': return withScope(result('start', { keywords: NEXT_KEYWORDS.explain }));
      case 'query': return withScope(result('keywords', { keywords: ['PLAN'] }));
      case 'plan': return withScope(result('start', { keywords: STATEMENT_START }));
      case 'create': return withScope(kwResult('create'));
      case 'drop': return withScope(stmt === 'alter' ? result('keywords', { keywords: ['COLUMN'] }) : kwResult('drop'));
      case 'alter': return withScope(kwResult('alter'));
      case 'add': return withScope(kwResult('alterAdd'));
      case 'rename': return withScope(result('keywords', { keywords: ['TO', 'COLUMN'] }));
      case 'column':
        if (stmt === 'alter' && (f.alterAction === 'drop' || f.alterAction === 'rename')) {
          return withScope(result('columnsOf', { target: scope.refs[0] ? scope.refs[0].name : (isName(tokens[i - 2]) ? tokens[i - 2].lv : null) }));
        }
        return withScope(result('none'));
      case 'temp': case 'temporary': return withScope(result('keywords', { keywords: ['TABLE', 'VIEW', 'TRIGGER'] }));
      case 'unique': return withScope(result('keywords', { keywords: stmt === 'create' && !f.objType ? ['INDEX'] : ['('] }));
      case 'virtual': return withScope(result('keywords', { keywords: ['TABLE'] }));
      case 'before': case 'after': return withScope(kwResult('triggerEvent'));
      case 'instead': return withScope(result('keywords', { keywords: ['OF'] }));
      case 'of':
        if (isKw(tokens[i - 1], 'instead')) return withScope(kwResult('triggerEvent'));
        return withScope(result('columns', { functions: false }));
      case 'for': return withScope(result('keywords', { keywords: ['EACH ROW'] }));
      case 'each': return withScope(result('keywords', { keywords: ['ROW'] }));
      case 'row': return withScope(result('keywords', { keywords: ['WHEN', 'BEGIN'] }));
      case 'references': return withScope(result('tables'));
      case 'primary': case 'foreign': return withScope(result('keywords', { keywords: ['KEY'] }));
      case 'key': return withScope(result('keywords', { keywords: ['(', 'AUTOINCREMENT', 'ASC', 'DESC'] }));
      case 'null': return withScope(kwResult('expr'));
      case 'without': return withScope(result('keywords', { keywords: ['ROWID'] }));
      case 'rowid': case 'strict': return withScope(result('keywords', { keywords: TABLE_OPTIONS }));
      case 'materialized': return withScope(result('keywords', { keywords: ['('] }));
      case 'over': return withScope(result('keywords', { keywords: ['('] }));
      case 'filter': return withScope(result('keywords', { keywords: ['(WHERE'] }));
      case 'default':
        if (stmt === 'insert') return withScope(result('keywords', { keywords: ['VALUES'] }));
        return withScope(result('exprNoColumns', { keywords: NEXT_KEYWORDS.values, functions: true }));
      case 'nulls': return withScope(result('keywords', { keywords: ['FIRST', 'LAST'] }));
      case 'asc': case 'desc': return withScope(kwResult('orderBy'));
      case 'cast': return withScope(result('keywords', { keywords: ['('] }));
      default:
        if (EXPR_CLAUSES.has(f.clause)) return withScope(exprResult());
        return withScope(result('keywords', { keywords: NEXT_KEYWORDS.expr }));
    }
  }

  // --- Comma / operator / close-paren / identifier before the cursor ---
  if (isPunct(prev, ',')) {
    switch (f.clause) {
      case 'from': case 'join': return withScope(result('tables'));
      case 'set': return withScope(result('columnsOf', { target: scope.refs[0] ? scope.refs[0].name : null }));
      case 'with': return withScope(result('none'));
      case 'values': return withScope(result('keywords', { keywords: ['('] }));
      case 'select': case 'orderBy': case 'groupBy': case 'partitionBy': case 'returning':
        return withScope(result('columns', { keywords: [], functions: true }));
      case 'alterColumn': return withScope(result('none'));
      default: return withScope(exprResult());
    }
  }
  if (prev.t === 'op') {
    if (prev.v === '*' && f.clause === 'select') return withScope(kwResult('selectList'));
    return withScope(exprResult());
  }
  if (isPunct(prev, ')')) {
    if (stmt === 'insert' && f.clause === 'into') return withScope(kwResult('insertTarget'));
    if (stmt === 'insert' && f.clause === 'values') return withScope(result('keywords', { keywords: [...NEXT_KEYWORDS.insertTail, ','] }));
    if (stmt === 'create' && f.objType === 'table' && f.clause === 'table') return withScope(kwResult('tableOptions'));
    if (stmt === 'create' && f.objType === 'index') return withScope(result('keywords', { keywords: ['WHERE'] }));
    if (f.clause === 'from' || f.clause === 'join') return withScope(kwResult('tableRef'));
    if (f.clause === 'with') return withScope(kwResult('withAfterCte'));
    if (f.clause === 'select') return withScope(kwResult('selectList'));
    if (f.clause === 'on' && stmt === 'insert') return withScope(result('keywords', { keywords: ['DO NOTHING', 'DO UPDATE SET'] }));
    if (f.clause === 'orderBy') return withScope(kwResult('orderBy'));
    return withScope(kwResult('expr'));
  }
  if (isName(prev) || prev.t === 'num' || prev.t === 'str' || prev.t === 'var') {
    const before = tokens[i - 1];
    switch (f.clause) {
      case 'from': case 'join': return withScope(kwResult('tableRef'));
      case 'into':
        if (stmt === 'insert') return withScope(kwResult('insertTarget'));
        break;
      case 'select': return withScope(kwResult('selectList'));
      case 'orderBy': return withScope(kwResult('orderBy'));
      case 'groupBy': return withScope(result('keywords', { keywords: [...NEXT_KEYWORDS.groupBy, ...NEXT_KEYWORDS.expr] }));
      case 'set': return withScope(result('keywords', { keywords: isName(prev) && isKw(before, 'set') || isPunct(before, ',') ? ['='] : ['WHERE', 'RETURNING', ...NEXT_KEYWORDS.expr] }));
      case 'limit': return withScope(result('keywords', { keywords: ['OFFSET', ','] }));
      case 'with': return withScope(result('keywords', { keywords: ['AS (', 'AS MATERIALIZED (', '('] }));
      case 'table':
        if (stmt === 'create') return withScope(kwResult('createTableAfterName'));
        if (stmt === 'alter') return withScope(kwResult('alterTable'));
        return withScope(result('none'));
      case 'view': return withScope(stmt === 'create' ? kwResult('createViewAfterName') : result('none'));
      case 'index': return withScope(stmt === 'create' ? (isKw(before, 'on') ? result('keywords', { keywords: ['('] }) : kwResult('createIndexAfterName')) : result('none'));
      case 'trigger': return withScope(stmt === 'create' ? kwResult('createTrigger') : result('none'));
      case 'triggerEvent': return withScope(isKw(before, 'on') ? kwResult('triggerBody') : result('keywords', { keywords: ['ON', ','] }));
      case 'alterAction':
        if (f.alterAction === 'add') return withScope(result('types', { keywords: NEXT_KEYWORDS.columnConstraint }));
        if (f.alterAction === 'rename') return withScope(result('keywords', { keywords: ['TO'] }));
        return withScope(result('none'));
      case 'alterColumn':
        if (f.alterAction === 'add') return withScope(result('types', { keywords: NEXT_KEYWORDS.columnConstraint }));
        if (f.alterAction === 'rename') return withScope(result('keywords', { keywords: ['TO'] }));
        return withScope(result('none'));
      case 'pragma': return withScope(kwResult('pragmaAfterName'));
      case 'references': return withScope(result('keywords', { keywords: ['(', ...NEXT_KEYWORDS.fkClause] }));
      case 'collate': return withScope(kwResult('expr'));
      case 'check': case 'default': return withScope(result('keywords', { keywords: NEXT_KEYWORDS.columnConstraint }));
      default: break;
    }
    if (stmt === 'attach' || stmt === 'detach') return withScope(result('keywords', { keywords: stmt === 'attach' ? ['AS', 'KEY'] : [] }));
    if (stmt === 'savepoint' || stmt === 'release') return withScope(result('none'));
    if (stmt === 'create' && f.objType === 'trigger' && f.clause === 'triggerBody') return withScope(result('start', { keywords: ['SELECT', 'INSERT INTO', 'UPDATE', 'DELETE FROM', 'END'] }));
    if (EXPR_CLAUSES.has(f.clause) || f.openerKind !== 'stmt') return withScope(kwResult('expr'));
    return withScope(kwResult('expr'));
  }
  return withScope(result('none'));
}

export const _internal = { tokenize, collectScope, walkFrames, FUNCTION_SET, PRAGMAS };

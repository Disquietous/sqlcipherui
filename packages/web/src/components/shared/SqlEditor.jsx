import { useRef, useEffect, useState } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightSpecialChars, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, indentUnit } from '@codemirror/language';
import { autocompletion, completionKeymap, acceptCompletion, closeCompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { sql, SQLite } from '@codemirror/lang-sql';
import { sqlHighlighting } from '../../editor/theme';
import { sqlCompletionSource } from '../../completion/source';
import { useSchemaStore } from '../../stores/schema';

const SQL_KW = new Set('select|from|where|and|or|not|in|is|null|like|order|by|group|having|limit|offset|join|inner|left|right|outer|on|as|insert|into|values|update|set|delete|create|table|index|view|trigger|drop|alter|add|column|primary|key|foreign|references|unique|default|distinct|case|when|then|else|end|union|all|begin|commit|rollback|pragma|explain|query|plan|with|exists|between|asc|desc|cross|natural|using|abort|action|after|autoincrement|before|cascade|conflict|current_date|current_time|current_timestamp|deferred|each|exclusive|fail|for|glob|if|ignore|immediate|instead|intersect|isnull|match|no|notnull|of|raise|regexp|release|rename|replace|restrict|row|savepoint|temp|temporary|to|transaction|vacuum|virtual'.split('|'));
const SQL_FN = new Set('count|sum|avg|min|max|coalesce|date|datetime|json_extract|substr|length|lower|upper|cast|now|abs|hex|ifnull|instr|last_insert_rowid|likelihood|likely|load_extension|ltrim|nullif|printf|quote|random|randomblob|round|rtrim|soundex|sqlite_version|total|total_changes|trim|typeof|unicode|unlikely|zeroblob|group_concat|json|json_array|json_object|json_type|json_valid|changes'.split('|'));

function highlightSQL(sql) {
  const out = [];
  const re = /(--[^\n]*)|('(?:[^'\\]|\\.|'')*')|("(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([(),;.*=<>!+\-/|&~%^])/g;
  let m, idx = 0;
  while ((m = re.exec(sql))) {
    if (m.index > idx) out.push(['', sql.slice(idx, m.index)]);
    const [whole, comment, sq, dq, num, word, ws] = m;
    if (comment) out.push(['comment', whole]);
    else if (sq) out.push(['str', whole]);
    else if (dq) out.push(['str', whole]);
    else if (num) out.push(['num', whole]);
    else if (word) {
      const lw = word.toLowerCase();
      if (SQL_KW.has(lw)) out.push(['kw', word]);
      else if (SQL_FN.has(lw)) out.push(['fn', word]);
      else out.push(['', word]);
    } else if (ws) out.push(['', whole]);
    else out.push(['op', whole]);
    idx = m.index + whole.length;
  }
  if (idx < sql.length) out.push(['', sql.slice(idx)]);
  return out;
}

/** Lightweight read-only highlighter (no CodeMirror instance). */
export function Highlighted({ sql }) {
  return (
    <>
      {highlightSQL(sql).map(([cls, t], i) => (
        <span key={i} className={cls ? `tok-${cls}` : undefined}>{t}</span>
      ))}
    </>
  );
}

const sqlLanguage = sql({ dialect: SQLite, upperCaseKeywords: false });

/**
 * CodeMirror 6 SQL editor.
 *
 * Props: value, onChange(text), onRun(), readOnly, minRows, className,
 *        db (connection id used for schema completion), placeholder.
 */
export function SqlEditor({ value, onChange, onRun, readOnly = false, minRows = 3, className = '', db, placeholder }) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const cbRef = useRef({ onChange, onRun, db });
  const [readOnlyCompartment] = useState(() => new Compartment());
  const [placeholderCompartment] = useState(() => new Compartment());

  useEffect(() => {
    cbRef.current.onChange = onChange;
    cbRef.current.onRun = onRun;
    cbRef.current.db = db;
  });

  useEffect(() => {
    const getIndex = () => useSchemaStore.getState().getIndex(cbRef.current.db);
    const runKey = {
      key: 'Mod-Enter',
      run: (v) => { if (cbRef.current.onRun) { closeCompletion(v); cbRef.current.onRun(); return true; } return false; },
    };
    const tabKeys = [
      { key: 'Tab', run: acceptCompletion },
      { key: 'Tab', run: (v) => { v.dispatch(v.state.replaceSelection('  ')); return true; } },
    ];
    const state = EditorState.create({
      doc: value || '',
      extensions: [
        keymap.of([runKey, ...tabKeys, ...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...defaultKeymap]),
        history(),
        drawSelection(),
        highlightSpecialChars(),
        bracketMatching(),
        closeBrackets(),
        indentUnit.of('  '),
        sqlLanguage,
        sqlHighlighting,
        autocompletion({
          override: [sqlCompletionSource(getIndex)],
          activateOnTyping: true,
          maxRenderedOptions: 50,
          icons: true,
          defaultKeymap: false,
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && cbRef.current.onChange) cbRef.current.onChange(u.state.doc.toString());
        }),
        readOnlyCompartment.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        placeholderCompartment.of(placeholder ? cmPlaceholder(placeholder) : []),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes (e.g. loading a saved query) → replace doc without echo loops.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    const next = value || '';
    if (cur !== next) view.dispatch({ changes: { from: 0, to: cur.length, insert: next } });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch({ effects: readOnlyCompartment.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly, readOnlyCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch({ effects: placeholderCompartment.reconfigure(placeholder ? cmPlaceholder(placeholder) : []) });
  }, [placeholder, placeholderCompartment]);

  // Make sure the completion snapshot for this connection is loaded.
  useEffect(() => {
    if (db) useSchemaStore.getState().loadSchema(db);
  }, [db]);

  return (
    <div
      ref={hostRef}
      className={`sql-editor ${className}`}
      style={{ minHeight: `calc(${minRows} * 1.6em + 20px)` }}
    />
  );
}

export function SqlReadOnly({ sql, className = '' }) {
  return (
    <pre className={`sql-readonly ${className}`}>
      <Highlighted sql={sql || ''} />
    </pre>
  );
}

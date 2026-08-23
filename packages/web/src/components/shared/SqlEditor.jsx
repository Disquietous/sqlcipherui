import { useRef, useCallback } from 'react';

const SQL_KW = new Set('select|from|where|and|or|not|in|is|null|like|order|by|group|having|limit|offset|join|inner|left|right|outer|on|as|insert|into|values|update|set|delete|create|table|index|view|trigger|drop|alter|add|column|primary|key|foreign|references|unique|default|distinct|case|when|then|else|end|union|all|begin|commit|rollback|pragma|explain|query|plan|with|exists|between|asc|desc|cross|natural|using|abort|action|after|autoincrement|before|cascade|conflict|current_date|current_time|current_timestamp|deferred|each|exclusive|fail|for|glob|if|ignore|immediate|instead|intersect|isnull|match|no|notnull|of|raise|regexp|release|rename|replace|restrict|row|savepoint|temp|temporary|to|transaction|vacuum|virtual'.split('|'));
const SQL_FN = new Set('count|sum|avg|min|max|coalesce|date|datetime|json_extract|substr|length|lower|upper|cast|now|abs|hex|ifnull|instr|last_insert_rowid|likelihood|likely|load_extension|ltrim|nullif|printf|quote|random|randomblob|round|rtrim|soundex|sqlite_version|total|total_changes|trim|typeof|unicode|unlikely|zeroblob|group_concat|json|json_array|json_object|json_type|json_valid|changes'.split('|'));

function highlightSQL(sql) {
  const out = [];
  const re = /(--[^\n]*)|('(?:[^'\\]|\\.|'')*')|("(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([(),;.*=<>!+\-/|&~%^])/g;
  let m, idx = 0;
  while ((m = re.exec(sql))) {
    if (m.index > idx) out.push(['', sql.slice(idx, m.index)]);
    const [whole, comment, sq, dq, num, word, ws, op] = m;
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

export function Highlighted({ sql }) {
  return (
    <>
      {highlightSQL(sql).map(([cls, t], i) => (
        <span key={i} className={cls ? `tok-${cls}` : undefined}>{t}</span>
      ))}
    </>
  );
}

export function SqlEditor({ value, onChange, onRun, readOnly = false, minRows = 3, className = '' }) {
  const taRef = useRef(null);

  const handleKeyDown = useCallback((e) => {
    if (onRun && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onRun();
    }
    if (!readOnly && e.key === 'Tab') {
      e.preventDefault();
      const ta = taRef.current;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newVal = value.substring(0, start) + '  ' + value.substring(end);
      onChange(newVal);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, [value, onChange, onRun, readOnly]);

  return (
    <div className={`sql-editor ${className}`}>
      <div
        className="sql-editor-inner"
        style={{ minHeight: `calc(${minRows} * 1.6em + 20px)` }}
      >
        <pre className="sql-editor-pre" aria-hidden>
          <Highlighted sql={value || ''} />{'\n'}
        </pre>
        <textarea
          ref={taRef}
          className="sql-editor-ta"
          value={value || ''}
          onChange={readOnly ? undefined : (e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          readOnly={readOnly}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
    </div>
  );
}

export function SqlReadOnly({ sql, className = '' }) {
  return (
    <pre className={`sql-readonly ${className}`}>
      <Highlighted sql={sql || ''} />
    </pre>
  );
}

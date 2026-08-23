import { useState, useEffect } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { useConnectionStore } from '../../stores/connection';
import { DF_NODE_BY_KIND } from './catalog';
import { DFField, DFText, DFTextarea, DFNumber, DFSelect, DFRadio } from './DFFormWidgets';
import { getTables } from '../../api/schema';

function useConnOptions() {
  const appConns = useConnectionStore((s) => s.connections);
  const dfConns = useDataFlowStore((s) => s.dfConnections);
  const options = [];
  for (const [path, info] of Object.entries(appConns)) {
    options.push({ value: path, label: info.name || path });
  }
  for (const c of dfConns) {
    if (!options.some(o => o.value === c.path)) {
      options.push({ value: c.path || c.name, label: c.name });
    }
  }
  return options;
}

function useTableList(connPath) {
  const [tables, setTables] = useState([]);
  useEffect(() => {
    if (!connPath) { setTables([]); return; }
    getTables(connPath).then(t => setTables(Array.isArray(t) ? t.map(r => r.name || r) : []))
      .catch(() => setTables([]));
  }, [connPath]);
  return tables;
}

function basename(p) {
  if (!p) return p;
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

function ConnSelect({ value, onChange }) {
  const options = useConnOptions();
  if (options.length === 0) {
    return <div className="muted small">No databases connected. Open a database first.</div>;
  }
  return (
    <select className="df-input" value={value ?? ''} onChange={e => onChange?.(e.target.value)} title={value || undefined}>
      <option value="">Select database…</option>
      {options.map(o => (
        <option key={o.value} value={o.value} title={o.value}>{basename(o.label) || o.label}</option>
      ))}
    </select>
  );
}

function TableSelect({ conn, value, onChange }) {
  const tables = useTableList(conn);
  const [newMode, setNewMode] = useState(false);
  const isNew = newMode || (value && tables.length > 0 && !tables.includes(value));
  if (!conn) return <DFText value={value} onChange={onChange} placeholder="Select a connection first" />;
  if (isNew) {
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          className="df-input mono"
          style={{ flex: 1 }}
          value={value ?? ''}
          onChange={e => onChange?.(e.target.value)}
          placeholder="new_table_name"
          autoFocus
        />
        {tables.length > 0 && (
          <button className="btn small" onClick={() => { setNewMode(false); onChange?.(''); }}>Existing</button>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <select
        className="df-input mono"
        style={{ flex: 1 }}
        value={value ?? ''}
        onChange={e => onChange?.(e.target.value)}
      >
        <option value="">Select table…</option>
        {tables.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <button className="btn small" onClick={() => setNewMode(true)}>New</button>
    </div>
  );
}

export function DFInspectorConfig({ node }) {
  const updateNodeConfig = useDataFlowStore((s) => s.updateNodeConfig);

  const cfg = node.config || {};
  const set = (key, val) => updateNodeConfig(node.id, { [key]: val });

  switch (node.kind) {
    case 'src-table':
    case 'src-view':
      return (
        <div className="df-form">
          <DFField label="Connection">
            <ConnSelect value={cfg.conn} onChange={v => set('conn', v)} />
          </DFField>
          <DFField label={node.kind === 'src-view' ? 'View' : 'Table'}>
            <TableSelect conn={cfg.conn} value={cfg.table} onChange={v => set('table', v)} />
          </DFField>
          <DFField label="Read mode">
            <DFRadio value={cfg.read_mode || 'snapshot'} options={[{ v: 'snapshot', l: 'Snapshot' }, { v: 'stream', l: 'Stream' }]} onChange={v => set('read_mode', v)} />
          </DFField>
          <DFField label="WHERE clause" hint="Optional pre-filter applied at the source.">
            <DFTextarea value={cfg.where} onChange={v => set('where', v)} placeholder="e.g. created_at > date('now','-30 day')" />
          </DFField>
          <DFField label="Batch size">
            <DFNumber value={cfg.batch_size ?? 5000} onChange={v => set('batch_size', v)} />
          </DFField>
        </div>
      );

    case 'src-sql':
      return (
        <div className="df-form">
          <DFField label="Connection">
            <ConnSelect value={cfg.conn} onChange={v => set('conn', v)} />
          </DFField>
          <DFField label="SQL query">
            <DFTextarea value={cfg.sql} onChange={v => set('sql', v)} placeholder="SELECT * FROM ..." />
          </DFField>
          <DFField label="Batch size">
            <DFNumber value={cfg.batch_size ?? 5000} onChange={v => set('batch_size', v)} />
          </DFField>
        </div>
      );

    case 'src-csv':
      return (
        <div className="df-form">
          <DFField label="File path">
            <DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/file.csv" />
          </DFField>
          <DFField label="Delimiter">
            <DFText value={cfg.delimiter ?? ','} onChange={v => set('delimiter', v)} />
          </DFField>
          <DFField label="Has header">
            <DFRadio value={cfg.header !== false ? 'yes' : 'no'} options={[{ v: 'yes', l: 'Yes' }, { v: 'no', l: 'No' }]} onChange={v => set('header', v === 'yes')} />
          </DFField>
        </div>
      );

    case 'src-json':
      return (
        <div className="df-form">
          <DFField label="File path">
            <DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/file.json" />
          </DFField>
          <DFField label="Format">
            <DFRadio value={cfg.format || 'array'} options={[{ v: 'array', l: 'JSON Array' }, { v: 'jsonl', l: 'JSONL' }]} onChange={v => set('format', v)} />
          </DFField>
        </div>
      );

    case 'src-parquet':
      return (
        <div className="df-form">
          <DFField label="File path">
            <DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/file.parquet" />
          </DFField>
        </div>
      );

    case 'src-ext-db':
      return (
        <div className="df-form">
          <DFField label="Database path">
            <DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/db.sqlite" />
          </DFField>
          <DFField label="Table">
            <DFText value={cfg.table} onChange={v => set('table', v)} mono />
          </DFField>
        </div>
      );

    case 'src-folder':
      return (
        <div className="df-form">
          <DFField label="Folder path">
            <DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/folder" />
          </DFField>
          <DFField label="Glob pattern">
            <DFText value={cfg.glob ?? '*.csv'} onChange={v => set('glob', v)} />
          </DFField>
          <DFField label="File format">
            <DFSelect value={cfg.format || 'csv'} options={['csv', 'json', 'parquet']} onChange={v => set('format', v)} />
          </DFField>
        </div>
      );

    case 'tf-filter':
      return (
        <div className="df-form">
          <DFField label="Predicate">
            <DFTextarea value={cfg.expr} onChange={v => set('expr', v)} mono placeholder="e.g. age > 18" />
          </DFField>
          <DFField label="On invalid expression">
            <DFRadio value={cfg.on_error || 'error'} options={[{ v: 'error', l: 'Stop' }, { v: 'skip', l: 'Skip row' }]} onChange={v => set('on_error', v)} />
          </DFField>
          {cfg.expr && (
            <div className="df-explain">
              <Icon name="fn" size={11} />
              <span>Generates: <code className="mono">SELECT * FROM &lt;input&gt; WHERE {cfg.expr}</code></span>
            </div>
          )}
        </div>
      );

    case 'tf-project':
      return (
        <div className="df-form">
          <DFField label="Columns" hint="Comma-separated column names to keep">
            <DFTextarea value={cfg.columns} onChange={v => set('columns', v)} placeholder="col1, col2, col3" />
          </DFField>
          <DFField label="Mode">
            <DFRadio value={cfg.mode || 'keep'} options={[{ v: 'keep', l: 'Keep listed' }, { v: 'drop', l: 'Drop listed' }]} onChange={v => set('mode', v)} />
          </DFField>
        </div>
      );

    case 'tf-rename':
      return (
        <div className="df-form">
          <DFField label="From">
            <DFText value={cfg.from_col} onChange={v => set('from_col', v)} mono />
          </DFField>
          <DFField label="To">
            <DFText value={cfg.to_col} onChange={v => set('to_col', v)} mono />
          </DFField>
        </div>
      );

    case 'tf-cast':
      return (
        <div className="df-form">
          <DFField label="Column">
            <DFText value={cfg.column} onChange={v => set('column', v)} mono />
          </DFField>
          <DFField label="Target type">
            <DFSelect value={cfg.target_type || 'TEXT'} options={['TEXT', 'INTEGER', 'REAL', 'BLOB']} onChange={v => set('target_type', v)} />
          </DFField>
        </div>
      );

    case 'tf-derive':
      return (
        <div className="df-form">
          <DFField label="Column name">
            <DFText value={cfg.name} onChange={v => set('name', v)} mono />
          </DFField>
          <DFField label="Expression">
            <DFTextarea value={cfg.expr} onChange={v => set('expr', v)} placeholder="e.g. price * quantity" />
          </DFField>
        </div>
      );

    case 'tf-join':
      return (
        <div className="df-form">
          <DFField label="Join type">
            <DFRadio value={cfg.join_type || 'left'} options={[{ v: 'inner', l: 'Inner' }, { v: 'left', l: 'Left' }, { v: 'right', l: 'Right' }, { v: 'full', l: 'Full' }]} onChange={v => set('join_type', v)} />
          </DFField>
          <DFField label="Left key">
            <DFText value={cfg.left_key} onChange={v => set('left_key', v)} mono />
          </DFField>
          <DFField label="Right key">
            <DFText value={cfg.right_key} onChange={v => set('right_key', v)} mono />
          </DFField>
        </div>
      );

    case 'tf-union':
      return (
        <div className="df-form">
          <DFField label="Mode">
            <DFRadio value={cfg.mode || 'all'} options={[{ v: 'all', l: 'Union All' }, { v: 'distinct', l: 'Union Distinct' }]} onChange={v => set('mode', v)} />
          </DFField>
        </div>
      );

    case 'tf-group':
      return (
        <div className="df-form">
          <DFField label="Group by" hint="Comma-separated column names">
            <DFText value={cfg.group_by} onChange={v => set('group_by', v)} mono />
          </DFField>
          <DFField label="Aggregates" hint="e.g. COUNT(*) as cnt, SUM(amount) as total">
            <DFTextarea value={cfg.aggregates} onChange={v => set('aggregates', v)} />
          </DFField>
        </div>
      );

    case 'tf-sort':
      return (
        <div className="df-form">
          <DFField label="Order by">
            <DFText value={cfg.order_by} onChange={v => set('order_by', v)} mono placeholder="col1 ASC, col2 DESC" />
          </DFField>
        </div>
      );

    case 'tf-limit':
      return (
        <div className="df-form">
          <DFField label="Max rows">
            <DFNumber value={cfg.limit ?? 1000} onChange={v => set('limit', v)} />
          </DFField>
          <DFField label="Offset">
            <DFNumber value={cfg.offset ?? 0} onChange={v => set('offset', v)} />
          </DFField>
        </div>
      );

    case 'tf-map':
      return (
        <div className="df-form">
          <div className="muted small">Use the Mapping tab to configure column-to-column mappings.</div>
        </div>
      );

    case 'cl-anon':
      return (
        <div className="df-form">
          <DFField label="Fields to anonymize" hint="Comma-separated column names">
            <DFText value={cfg.fields} onChange={v => set('fields', v)} mono />
          </DFField>
          <DFField label="Strategy">
            <DFSelect value={cfg.strategy || 'hash'} options={['hash', 'redact', 'fake', 'tokenize']} onChange={v => set('strategy', v)} />
          </DFField>
          <DFField label="Hash salt">
            <DFText value={cfg.salt} onChange={v => set('salt', v)} mono placeholder="env:DF_ANON_SALT" />
          </DFField>
        </div>
      );

    case 'cl-dedupe':
      return (
        <div className="df-form">
          <DFField label="Deduplicate by" hint="Comma-separated key columns">
            <DFText value={cfg.by} onChange={v => set('by', v)} mono />
          </DFField>
          <DFField label="Keep">
            <DFRadio value={cfg.keep || 'first'} options={[{ v: 'first', l: 'First' }, { v: 'last', l: 'Last' }]} onChange={v => set('keep', v)} />
          </DFField>
          <DFField label="Order by">
            <DFText value={cfg.order_by} onChange={v => set('order_by', v)} mono />
          </DFField>
        </div>
      );

    case 'cl-fill-null':
      return (
        <div className="df-form">
          <DFField label="Column">
            <DFText value={cfg.column} onChange={v => set('column', v)} mono />
          </DFField>
          <DFField label="Fill value">
            <DFText value={cfg.fill_value} onChange={v => set('fill_value', v)} />
          </DFField>
        </div>
      );

    case 'cl-trim':
      return (
        <div className="df-form">
          <DFField label="Columns" hint="Comma-separated, or blank for all text columns">
            <DFText value={cfg.columns} onChange={v => set('columns', v)} mono />
          </DFField>
        </div>
      );

    case 'cl-case':
      return (
        <div className="df-form">
          <DFField label="Columns" hint="Comma-separated">
            <DFText value={cfg.columns} onChange={v => set('columns', v)} mono />
          </DFField>
          <DFField label="Case">
            <DFRadio value={cfg.case_type || 'lower'} options={[{ v: 'lower', l: 'Lower' }, { v: 'upper', l: 'Upper' }, { v: 'title', l: 'Title' }]} onChange={v => set('case_type', v)} />
          </DFField>
        </div>
      );

    case 'cl-validate':
      return (
        <div className="df-form">
          <DFField label="Rules" hint="SQL expressions that must be true for each row">
            <DFTextarea value={cfg.rules} onChange={v => set('rules', v)} placeholder="e.g. email IS NOT NULL AND length(email) > 0" />
          </DFField>
          <DFField label="On failure">
            <DFRadio value={cfg.on_fail || 'reject'} options={[{ v: 'reject', l: 'Reject row' }, { v: 'error', l: 'Stop pipeline' }]} onChange={v => set('on_fail', v)} />
          </DFField>
        </div>
      );

    case 'sc-add-col':
      return (
        <div className="df-form">
          <DFField label="Target table">
            <DFText value={cfg.table} onChange={v => set('table', v)} mono />
          </DFField>
          <DFField label="Column definition">
            <DFText value={cfg.col} onChange={v => set('col', v)} mono placeholder="name TYPE DEFAULT value" />
          </DFField>
          <DFField label="Backfill from">
            <DFRadio value={cfg.backfill || 'upstream'} options={[{ v: 'upstream', l: 'Upstream' }, { v: 'expr', l: 'Expression' }, { v: 'null', l: 'NULL' }]} onChange={v => set('backfill', v)} />
          </DFField>
        </div>
      );

    case 'sc-drop-col':
      return (
        <div className="df-form">
          <DFField label="Table">
            <DFText value={cfg.table} onChange={v => set('table', v)} mono />
          </DFField>
          <DFField label="Column">
            <DFText value={cfg.column} onChange={v => set('column', v)} mono />
          </DFField>
        </div>
      );

    case 'sc-rename-col':
      return (
        <div className="df-form">
          <DFField label="Table">
            <DFText value={cfg.table} onChange={v => set('table', v)} mono />
          </DFField>
          <DFField label="From">
            <DFText value={cfg.from_col} onChange={v => set('from_col', v)} mono />
          </DFField>
          <DFField label="To">
            <DFText value={cfg.to_col} onChange={v => set('to_col', v)} mono />
          </DFField>
        </div>
      );

    case 'sc-cast-col':
      return (
        <div className="df-form">
          <DFField label="Table">
            <DFText value={cfg.table} onChange={v => set('table', v)} mono />
          </DFField>
          <DFField label="Column">
            <DFText value={cfg.column} onChange={v => set('column', v)} mono />
          </DFField>
          <DFField label="Target type">
            <DFSelect value={cfg.target_type || 'TEXT'} options={['TEXT', 'INTEGER', 'REAL', 'BLOB']} onChange={v => set('target_type', v)} />
          </DFField>
        </div>
      );

    case 'sc-add-index':
      return (
        <div className="df-form">
          <DFField label="Table">
            <DFText value={cfg.table} onChange={v => set('table', v)} mono />
          </DFField>
          <DFField label="Columns" hint="Comma-separated">
            <DFText value={cfg.columns} onChange={v => set('columns', v)} mono />
          </DFField>
          <DFField label="Unique">
            <DFRadio value={cfg.unique ? 'yes' : 'no'} options={[{ v: 'no', l: 'No' }, { v: 'yes', l: 'Yes' }]} onChange={v => set('unique', v === 'yes')} />
          </DFField>
        </div>
      );

    case 'co-sql':
      return (
        <div className="df-form" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <DFField label="SQL">
            <DFTextarea value={cfg.sql} onChange={v => set('sql', v)} placeholder="SELECT * FROM input" />
          </DFField>
        </div>
      );

    case 'co-py':
      return (
        <div className="df-form">
          <DFField label="Python script" hint="Sandboxed. Input rows as `rows` list of dicts, return list of dicts.">
            <DFTextarea value={cfg.script} onChange={v => set('script', v)} placeholder="return [r for r in rows if r['status'] == 'active']" />
          </DFField>
        </div>
      );

    case 'co-js':
      return (
        <div className="df-form">
          <DFField label="JavaScript" hint="Sandboxed. Input rows as `rows`, return array of objects.">
            <DFTextarea value={cfg.script} onChange={v => set('script', v)} placeholder="return rows.filter(r => r.status === 'active')" />
          </DFField>
        </div>
      );

    case 'snk-table':
    case 'snk-ext-db':
      return (
        <div className="df-form">
          <DFField label="Connection">
            <ConnSelect value={cfg.conn} onChange={v => set('conn', v)} />
          </DFField>
          <DFField label="Target table">
            <TableSelect conn={cfg.conn} value={cfg.table} onChange={v => set('table', v)} />
          </DFField>
          <DFField label="Write mode">
            <DFRadio value={cfg.write_mode || 'append'} options={[{ v: 'append', l: 'Append' }, { v: 'replace', l: 'Replace' }, { v: 'upsert', l: 'Upsert' }]} onChange={v => set('write_mode', v)} />
          </DFField>
          {cfg.write_mode === 'upsert' && (
            <DFField label="Key column(s)">
              <DFText value={cfg.key} onChange={v => set('key', v)} mono />
            </DFField>
          )}
          <DFField label="On conflict">
            <DFRadio value={cfg.on_conflict || 'update'} options={[{ v: 'update', l: 'Update' }, { v: 'ignore', l: 'Ignore' }, { v: 'error', l: 'Error' }]} onChange={v => set('on_conflict', v)} />
          </DFField>
          <DFField label="Batch size">
            <DFNumber value={cfg.batch_size ?? 1000} onChange={v => set('batch_size', v)} />
          </DFField>
        </div>
      );

    case 'snk-csv':
      return (
        <div className="df-form">
          <DFField label="Output path">
            <DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/output.csv" />
          </DFField>
          <DFField label="Delimiter">
            <DFText value={cfg.delimiter ?? ','} onChange={v => set('delimiter', v)} />
          </DFField>
          <DFField label="Include header">
            <DFRadio value={cfg.header !== false ? 'yes' : 'no'} options={[{ v: 'yes', l: 'Yes' }, { v: 'no', l: 'No' }]} onChange={v => set('header', v === 'yes')} />
          </DFField>
        </div>
      );

    case 'snk-json':
      return (
        <div className="df-form">
          <DFField label="Output path">
            <DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/output.json" />
          </DFField>
          <DFField label="Format">
            <DFRadio value={cfg.format || 'array'} options={[{ v: 'array', l: 'JSON Array' }, { v: 'jsonl', l: 'JSONL' }]} onChange={v => set('format', v)} />
          </DFField>
        </div>
      );

    case 'snk-parquet':
      return (
        <div className="df-form">
          <DFField label="Output path">
            <DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/output.parquet" />
          </DFField>
        </div>
      );

    default:
      return (
        <div className="df-form">
          <DFField label="Summary">
            <DFText value={node.summary} onChange={v => useDataFlowStore.getState().updateNodeSummary(node.id, v)} />
          </DFField>
          <div className="muted small" style={{ marginTop: 8 }}>
            No additional config for this node type yet.
          </div>
        </div>
      );
  }
}

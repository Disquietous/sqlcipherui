import { useEffect, useId, useState } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore, upstreamColumns } from '../../stores/dataflow';
import { useConnectionStore } from '../../stores/connection';
import { DF_NODE_BY_KIND } from './catalog';
import {
  DFField, DFText, DFTextarea, DFNumber, DFSelect, DFRadio, DFCheckbox, DFPassword,
} from './DFFormWidgets';
import { getTables, getViews } from '../../api/schema';

const SQL_TYPES = ['TEXT', 'INTEGER', 'REAL', 'BLOB'];

// ---------------------------------------------------------------------------
// Connection / table pickers
// ---------------------------------------------------------------------------

function useConnOptions() {
  const appConns = useConnectionStore((s) => s.connections);
  const dfConns = useDataFlowStore((s) => s.dfConnections);
  const options = [];
  for (const [path, info] of Object.entries(appConns)) {
    options.push({ value: path, label: info.name || path, source: 'open' });
  }
  for (const c of dfConns) {
    if (c.path && !options.some(o => o.value === c.path)) {
      options.push({ value: c.path, label: c.name, source: 'registered' });
    }
  }
  return options;
}

/**
 * Fetch the table (or view) names for a connection. State is keyed by the
 * request, so the visible list is *derived* from the current `conn` rather
 * than synced in an effect. `failed` is true when the API refused the path
 * (e.g. a registered Data Flow connection that is not open in the app).
 */
function useTableList(conn, kind = 'table') {
  const [result, setResult] = useState({ key: null, names: [], failed: false });
  const key = conn ? `${kind}:${conn}` : null;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const fetcher = kind === 'view' ? getViews : getTables;
    fetcher(conn)
      .then(rows => {
        if (cancelled) return;
        const names = Array.isArray(rows) ? rows.map(r => (typeof r === 'string' ? r : r.name)).filter(Boolean) : [];
        setResult({ key, names, failed: false });
      })
      .catch(() => { if (!cancelled) setResult({ key, names: [], failed: true }); });
    return () => { cancelled = true; };
  }, [key, conn, kind]);

  const current = result.key === key;
  return {
    names: current ? result.names : [],
    failed: current ? result.failed : false,
    loading: !!key && !current,
  };
}

function basename(p) {
  if (!p) return p;
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

function ConnSelect({ value, onChange, label = 'Database' }) {
  const options = useConnOptions();
  const hasValue = value && !options.some(o => o.value === value);
  if (options.length === 0 && !value) {
    return <div className="muted small">No databases available. Open a database in the app or register one under Connections.</div>;
  }
  return (
    <select className="df-input" value={value ?? ''} onChange={e => onChange?.(e.target.value)} title={value || undefined} aria-label={label}>
      <option value="">Select database…</option>
      {hasValue && <option value={value}>{basename(value)} (not registered)</option>}
      {options.map(o => (
        <option key={o.value} value={o.value} title={o.value}>
          {basename(o.label) || o.label}{o.source === 'registered' ? ' · registered' : ''}
        </option>
      ))}
    </select>
  );
}

/**
 * Table picker. Falls back to a plain text input when the connection's
 * table list cannot be fetched (registered-but-closed database) or when the
 * user wants a table that does not exist yet.
 */
function TableSelect({ conn, value, onChange, kind = 'table', allowNew = true }) {
  const { names, failed, loading } = useTableList(conn, kind);
  const [newMode, setNewMode] = useState(false);
  const noun = kind === 'view' ? 'view' : 'table';

  if (!conn) return <DFText value={value} onChange={onChange} mono placeholder={`Select a database first, or type a ${noun} name`} ariaLabel={noun} />;
  if (failed) {
    return (
      <div className="df-stack">
        <DFText value={value} onChange={onChange} mono placeholder={`${noun}_name`} ariaLabel={noun} />
        <div className="muted small">Could not list {noun}s for this database (it may not be open). Type the name.</div>
      </div>
    );
  }
  if (loading && !value) return <div className="df-input muted">Loading {noun}s…</div>;

  const isNew = newMode || (value && names.length > 0 && !names.includes(value));
  if (isNew || names.length === 0) {
    return (
      <div className="df-inline">
        <input
          className="df-input mono"
          style={{ flex: 1 }}
          value={value ?? ''}
          onChange={e => onChange?.(e.target.value)}
          placeholder={`new_${noun}_name`}
          aria-label={noun}
        />
        {names.length > 0 && (
          <button type="button" className="btn small" onClick={() => { setNewMode(false); onChange?.(''); }}>Existing</button>
        )}
      </div>
    );
  }
  return (
    <div className="df-inline">
      <select className="df-input mono" style={{ flex: 1 }} value={value ?? ''} onChange={e => onChange?.(e.target.value)} aria-label={noun}>
        <option value="">Select {noun}…</option>
        {names.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      {allowNew && <button type="button" className="btn small" onClick={() => setNewMode(true)}>New</button>}
    </div>
  );
}

/** Text input with a datalist of the node's upstream column names. */
function ColumnText({ nodeId, value, onChange, placeholder }) {
  const listId = useId();
  const nodeColumns = useDataFlowStore((s) => s.nodeColumns);
  const definition = useDataFlowStore((s) => s.pipeline?.definition);
  const cols = upstreamColumns({ pipeline: { definition }, nodeColumns }, nodeId);
  return (
    <>
      <DFText value={value} onChange={onChange} mono placeholder={placeholder} list={cols.length ? listId : undefined} />
      {cols.length > 0 && (
        <datalist id={listId}>
          {cols.map(c => <option key={c.name} value={c.name} />)}
        </datalist>
      )}
    </>
  );
}

const YES_NO = [{ v: 'yes', l: 'Yes' }, { v: 'no', l: 'No' }];
const boolRadio = (val, onChange, dflt = true) => (
  <DFRadio value={(val ?? dflt) ? 'yes' : 'no'} options={YES_NO} onChange={v => onChange(v === 'yes')} />
);

// ---------------------------------------------------------------------------
// Per-kind forms.  Each receives { node, cfg, set }.
// ---------------------------------------------------------------------------

function SrcTableForm({ node, cfg, set }) {
  const isView = node.kind === 'src-view';
  // Legacy definitions stored the view name under `view`.
  const table = cfg.table ?? cfg.view;
  return (
    <>
      <DFField label="Database"><ConnSelect value={cfg.conn} onChange={v => set('conn', v)} /></DFField>
      <DFField label={isView ? 'View' : 'Table'}>
        <TableSelect conn={cfg.conn} kind={isView ? 'view' : 'table'} value={table} onChange={v => set('table', v)} allowNew={false} />
      </DFField>
      <DFField label="WHERE" hint="Optional predicate appended as WHERE at the source.">
        <DFTextarea value={cfg.where} onChange={v => set('where', v)} placeholder="created_at > date('now', '-30 day')" />
      </DFField>
    </>
  );
}

function SrcSqlForm({ cfg, set }) {
  return (
    <>
      <DFField label="Database"><ConnSelect value={cfg.conn} onChange={v => set('conn', v)} /></DFField>
      <DFField label="SQL query" hint="Must be a single SELECT or WITH statement.">
        <DFTextarea value={cfg.sql} onChange={v => set('sql', v)} rows={6} placeholder="SELECT * FROM orders WHERE total > 100" />
      </DFField>
    </>
  );
}

function SrcCsvForm({ cfg, set }) {
  return (
    <>
      <DFField label="File path"><DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/file.csv" /></DFField>
      <DFField label="Delimiter"><DFText value={cfg.delimiter ?? ','} onChange={v => set('delimiter', v)} mono /></DFField>
      <DFField label="Has header row" hint="When No, columns are named c1 … cN.">{boolRadio(cfg.header, v => set('header', v))}</DFField>
    </>
  );
}

function SrcJsonForm({ cfg, set }) {
  return (
    <>
      <DFField label="File path"><DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/file.json" /></DFField>
      <DFField label="Format">
        <DFRadio value={cfg.format || 'array'} options={[{ v: 'array', l: 'JSON array' }, { v: 'jsonl', l: 'JSON Lines' }]} onChange={v => set('format', v)} />
      </DFField>
    </>
  );
}

function SrcParquetForm({ cfg, set }) {
  return (
    <>
      <DFField label="File path" hint="Requires the optional parquet extra (pip install sqlcipherui-core[parquet]).">
        <DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/file.parquet" />
      </DFField>
    </>
  );
}

function SrcExtDbForm({ cfg, set }) {
  return (
    <>
      <DFField label="Database file"><DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/other.db" /></DFField>
      <DFField label="Table"><DFText value={cfg.table} onChange={v => set('table', v)} mono placeholder="table_name" /></DFField>
      <DFField label="Key" hint="Leave blank for a plain SQLite file. Accepts a passphrase or a raw key as x'…64 hex…'.">
        <DFPassword value={cfg.key} onChange={v => set('key', v)} placeholder="passphrase (optional)" />
      </DFField>
      <DFField label="WHERE">
        <DFTextarea value={cfg.where} onChange={v => set('where', v)} placeholder="status = 'active'" />
      </DFField>
    </>
  );
}

function SrcFolderForm({ cfg, set }) {
  return (
    <>
      <DFField label="Folder path"><DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/folder" /></DFField>
      <DFField label="Glob pattern" hint="Matched inside the folder, e.g. *.csv or 2024-*.json"><DFText value={cfg.glob ?? '*'} onChange={v => set('glob', v)} mono /></DFField>
      <DFField label="File format"><DFSelect value={cfg.format || 'csv'} options={['csv', 'json', 'parquet']} onChange={v => set('format', v)} /></DFField>
      <DFCheckbox checked={cfg.add_source_column} onChange={v => set('add_source_column', v)} label="Add _source_file column" hint="Each row records the file it came from." />
    </>
  );
}

function TfFilterForm({ cfg, set }) {
  return (
    <>
      <DFField label="Predicate"><DFTextarea value={cfg.expr} onChange={v => set('expr', v)} placeholder="age > 18 AND country = 'US'" /></DFField>
      {cfg.expr && (
        <div className="df-explain">
          <Icon name="fn" size={11} />
          <span>Runs as <code className="mono">SELECT * FROM _input WHERE {cfg.expr}</code></span>
        </div>
      )}
    </>
  );
}

function TfProjectForm({ cfg, set }) {
  return (
    <>
      <DFField label="Columns" hint="Comma-separated column names."><DFTextarea value={cfg.columns} onChange={v => set('columns', v)} placeholder="id, email, created_at" /></DFField>
      <DFField label="Mode"><DFRadio value={cfg.mode || 'keep'} options={[{ v: 'keep', l: 'Keep listed' }, { v: 'drop', l: 'Drop listed' }]} onChange={v => set('mode', v)} /></DFField>
    </>
  );
}

function TfRenameForm({ node, cfg, set }) {
  return (
    <>
      <DFField label="From"><ColumnText nodeId={node.id} value={cfg.from_col} onChange={v => set('from_col', v)} /></DFField>
      <DFField label="To"><DFText value={cfg.to_col} onChange={v => set('to_col', v)} mono /></DFField>
    </>
  );
}

function TfCastForm({ node, cfg, set }) {
  return (
    <>
      <DFField label="Column"><ColumnText nodeId={node.id} value={cfg.column} onChange={v => set('column', v)} /></DFField>
      <DFField label="Target type"><DFSelect value={cfg.target_type || 'TEXT'} options={SQL_TYPES} onChange={v => set('target_type', v)} /></DFField>
    </>
  );
}

function TfDeriveForm({ cfg, set }) {
  return (
    <>
      <DFField label="New column"><DFText value={cfg.name} onChange={v => set('name', v)} mono placeholder="total" /></DFField>
      <DFField label="Expression"><DFTextarea value={cfg.expr} onChange={v => set('expr', v)} placeholder="price * quantity" /></DFField>
    </>
  );
}

function TfJoinForm({ cfg, set }) {
  return (
    <>
      <DFField label="Join type">
        <DFRadio value={(cfg.join_type || 'INNER').toUpperCase()} options={[{ v: 'INNER', l: 'Inner' }, { v: 'LEFT', l: 'Left' }, { v: 'RIGHT', l: 'Right' }, { v: 'FULL', l: 'Full' }]} onChange={v => set('join_type', v)} />
      </DFField>
      <DFField label="Left key" hint="Column on the L input."><DFText value={cfg.left_key} onChange={v => set('left_key', v)} mono /></DFField>
      <DFField label="Right key" hint="Column on the R input. Colliding non-key columns get an _r suffix."><DFText value={cfg.right_key} onChange={v => set('right_key', v)} mono /></DFField>
    </>
  );
}

function TfUnionForm({ cfg, set }) {
  return (
    <DFField label="Mode" hint="Columns are the union of all inputs; missing values become NULL.">
      <DFRadio value={cfg.mode || 'all'} options={[{ v: 'all', l: 'Union all' }, { v: 'distinct', l: 'Distinct' }]} onChange={v => set('mode', v)} />
    </DFField>
  );
}

function TfGroupForm({ cfg, set }) {
  return (
    <>
      <DFField label="Group by" hint="Comma-separated columns."><DFText value={cfg.group_by} onChange={v => set('group_by', v)} mono placeholder="country, year" /></DFField>
      <DFField label="Aggregates" hint="e.g. COUNT(*) AS cnt, SUM(amount) AS total"><DFTextarea value={cfg.aggregates} onChange={v => set('aggregates', v)} /></DFField>
    </>
  );
}

function TfSortForm({ cfg, set }) {
  return <DFField label="Order by"><DFText value={cfg.order_by} onChange={v => set('order_by', v)} mono placeholder="created_at DESC, id ASC" /></DFField>;
}

function TfLimitForm({ cfg, set }) {
  return (
    <div className="df-inline df-inline-fields">
      <DFField label="Limit"><DFNumber value={cfg.limit ?? 1000} min={0} onChange={v => set('limit', v)} /></DFField>
      <DFField label="Offset"><DFNumber value={cfg.offset ?? 0} min={0} onChange={v => set('offset', v)} /></DFField>
    </div>
  );
}

function TfMapForm({ cfg, set }) {
  const n = Array.isArray(cfg.mappings) ? cfg.mappings.length : 0;
  return (
    <>
      <div className="df-explain">
        <Icon name="mapping" size={11} />
        <span>{n} column mapping{n === 1 ? '' : 's'} defined. Edit them in the <b>Mapping</b> tab.</span>
      </div>
      <DFCheckbox checked={cfg.drop_unmapped} onChange={v => set('drop_unmapped', v)} label="Drop unmapped columns" hint="Only the mapped columns pass through." />
    </>
  );
}

function ClDedupeForm({ cfg, set }) {
  return (
    <>
      <DFField label="Deduplicate by" hint="Comma-separated key columns."><DFText value={cfg.by} onChange={v => set('by', v)} mono /></DFField>
      <DFField label="Keep"><DFRadio value={cfg.keep || 'first'} options={[{ v: 'first', l: 'First' }, { v: 'last', l: 'Last' }]} onChange={v => set('keep', v)} /></DFField>
      <DFField label="Order by" hint="Optional; decides which row is first."><DFText value={cfg.order_by} onChange={v => set('order_by', v)} mono placeholder="updated_at DESC" /></DFField>
    </>
  );
}

function ClFillNullForm({ node, cfg, set }) {
  return (
    <>
      <DFField label="Column"><ColumnText nodeId={node.id} value={cfg.column} onChange={v => set('column', v)} /></DFField>
      <DFField label="Replacement value"><DFText value={cfg.value} onChange={v => set('value', v)} placeholder="0" /></DFField>
    </>
  );
}

function ClTrimForm({ cfg, set }) {
  return <DFField label="Columns" hint="Comma-separated, or blank for all text columns."><DFText value={cfg.columns} onChange={v => set('columns', v)} mono /></DFField>;
}

function ClCaseForm({ cfg, set }) {
  return (
    <>
      <DFField label="Columns" hint="Comma-separated, or blank for all text columns."><DFText value={cfg.columns} onChange={v => set('columns', v)} mono /></DFField>
      <DFField label="Case"><DFRadio value={cfg.mode || 'lower'} options={[{ v: 'lower', l: 'lower' }, { v: 'upper', l: 'UPPER' }, { v: 'title', l: 'Title' }]} onChange={v => set('mode', v)} /></DFField>
    </>
  );
}

const ANON_METHODS = [
  { v: 'hash', l: 'hash — sha256(salt + value), 16 hex chars' },
  { v: 'redact', l: 'redact — replace with ***' },
  { v: 'tokenize', l: 'tokenize — stable tok_XXXXXXXX per value' },
  { v: 'fake', l: 'fake — deterministic fake email / name / phone' },
];

function ClAnonForm({ cfg, set }) {
  return (
    <>
      <DFField label="Columns" hint="Comma-separated PII columns."><DFText value={cfg.columns} onChange={v => set('columns', v)} mono placeholder="email, phone, full_name" /></DFField>
      <DFField label="Method"><DFSelect value={cfg.method || 'hash'} options={ANON_METHODS} onChange={v => set('method', v)} /></DFField>
      <DFField label="Salt" hint="A literal string, or env:VAR_NAME to read the salt from an environment variable at run time.">
        <DFText value={cfg.salt} onChange={v => set('salt', v)} mono placeholder="env:DF_ANON_SALT" />
      </DFField>
    </>
  );
}

// ---- cl-validate rules editor ---------------------------------------------

const CHECKS = ['not_null', 'unique', 'numeric', 'non_empty', 'regex'];

function normalizeRules(rules) {
  if (Array.isArray(rules)) return rules.filter(r => r && typeof r === 'object');
  if (typeof rules === 'string' && rules.trim()) return [{ expr: rules.trim() }];
  return [];
}

function ValidateRuleRow({ rule, onChange, onRemove, nodeId }) {
  const isExpr = 'expr' in rule || !('column' in rule);
  const check = rule.check || 'not_null';
  const isRegex = check.startsWith('regex:') || check === 'regex';
  const checkKind = isRegex ? 'regex' : check;
  const pattern = isRegex ? check.slice('regex:'.length) : '';

  return (
    <div className="df-rule">
      <DFRadio
        ariaLabel="Rule type"
        value={isExpr ? 'expr' : 'column'}
        options={[{ v: 'expr', l: 'Expression' }, { v: 'column', l: 'Column check' }]}
        onChange={v => onChange(v === 'expr' ? { expr: rule.expr || '' } : { column: rule.column || '', check: 'not_null' })}
      />
      {isExpr ? (
        <DFText value={rule.expr} onChange={v => onChange({ expr: v })} mono placeholder="email LIKE '%@%'" ariaLabel="Rule expression" />
      ) : (
        <div className="df-inline">
          <div style={{ flex: 1 }}>
            <ColumnText nodeId={nodeId} value={rule.column} onChange={v => onChange({ ...rule, column: v })} placeholder="column" />
          </div>
          <DFSelect
            ariaLabel="Check"
            compact
            value={checkKind}
            options={CHECKS}
            onChange={v => onChange({ ...rule, check: v === 'regex' ? `regex:${pattern}` : v })}
          />
        </div>
      )}
      {!isExpr && isRegex && (
        <DFText value={pattern} onChange={v => onChange({ ...rule, check: `regex:${v}` })} mono placeholder="^[A-Z]{2}\\d{4}$" ariaLabel="Regex pattern" />
      )}
      <button type="button" className="iconbtn-sm df-rule-remove" onClick={onRemove} aria-label="Remove rule" title="Remove rule">
        <Icon name="close" size={10} />
      </button>
    </div>
  );
}

function ClValidateForm({ node, cfg, set }) {
  const rules = normalizeRules(cfg.rules);
  const update = (i, r) => set('rules', rules.map((x, j) => (j === i ? r : x)));
  const remove = (i) => set('rules', rules.filter((_, j) => j !== i));
  return (
    <>
      <DFField label="Rules" hint="Every rule must hold for a row to pass.">
        <div className="df-rules">
          {rules.length === 0 && <div className="muted small">No rules yet.</div>}
          {rules.map((r, i) => (
            <ValidateRuleRow key={i} rule={r} nodeId={node.id} onChange={x => update(i, x)} onRemove={() => remove(i)} />
          ))}
          <div className="df-inline">
            <button type="button" className="btn small" onClick={() => set('rules', [...rules, { expr: '' }])}><Icon name="plus" size={10} /> Expression</button>
            <button type="button" className="btn small" onClick={() => set('rules', [...rules, { column: '', check: 'not_null' }])}><Icon name="plus" size={10} /> Column check</button>
          </div>
        </div>
      </DFField>
      <DFField label="On failure" hint={
        cfg.on_fail === 'fail' ? 'The run fails on the first row that breaks a rule.'
          : cfg.on_fail === 'route' ? 'Failing rows leave through the "rejected" output port; connect it to a sink to keep them.'
            : 'Failing rows are discarded and the run is marked partial.'
      }>
        <DFSelect value={cfg.on_fail || 'drop'} options={[{ v: 'drop', l: 'Drop failing rows' }, { v: 'fail', l: 'Fail the run' }, { v: 'route', l: 'Route to "rejected" port' }]} onChange={v => set('on_fail', v)} />
      </DFField>
    </>
  );
}

// ---- schema ops -----------------------------------------------------------

function SchemaTarget({ cfg, set }) {
  return (
    <>
      <DFField label="Database"><ConnSelect value={cfg.conn} onChange={v => set('conn', v)} /></DFField>
      <DFField label="Table"><TableSelect conn={cfg.conn} value={cfg.table} onChange={v => set('table', v)} allowNew={false} /></DFField>
    </>
  );
}

function ScAddColForm({ cfg, set }) {
  return (
    <>
      <SchemaTarget cfg={cfg} set={set} />
      <DFField label="Column"><DFText value={cfg.column} onChange={v => set('column', v)} mono /></DFField>
      <DFField label="Type"><DFSelect value={cfg.type || 'TEXT'} options={SQL_TYPES} onChange={v => set('type', v)} /></DFField>
      <DFField label="Default" hint="Optional SQL literal, e.g. 0 or 'n/a'."><DFText value={cfg.default} onChange={v => set('default', v)} mono /></DFField>
    </>
  );
}

function ScDropColForm({ cfg, set }) {
  return (
    <>
      <SchemaTarget cfg={cfg} set={set} />
      <DFField label="Column"><DFText value={cfg.column} onChange={v => set('column', v)} mono /></DFField>
    </>
  );
}

function ScRenameColForm({ cfg, set }) {
  return (
    <>
      <SchemaTarget cfg={cfg} set={set} />
      <DFField label="From"><DFText value={cfg.from_col} onChange={v => set('from_col', v)} mono /></DFField>
      <DFField label="To"><DFText value={cfg.to_col} onChange={v => set('to_col', v)} mono /></DFField>
    </>
  );
}

function ScCastColForm({ cfg, set }) {
  return (
    <>
      <SchemaTarget cfg={cfg} set={set} />
      <DFField label="Column"><DFText value={cfg.column} onChange={v => set('column', v)} mono /></DFField>
      <DFField label="Target type" hint="Rebuilds the column in one transaction: add temp column, CAST, drop, rename.">
        <DFSelect value={cfg.target_type || 'TEXT'} options={SQL_TYPES} onChange={v => set('target_type', v)} />
      </DFField>
    </>
  );
}

function ScAddIndexForm({ cfg, set }) {
  const cols = (cfg.columns || '').split(',').map(s => s.trim()).filter(Boolean);
  return (
    <>
      <SchemaTarget cfg={cfg} set={set} />
      <DFField label="Columns" hint="Comma-separated."><DFText value={cfg.columns} onChange={v => set('columns', v)} mono /></DFField>
      <DFField label="Unique">{boolRadio(cfg.unique, v => set('unique', v), false)}</DFField>
      {cfg.table && cols.length > 0 && (
        <div className="df-explain">
          <Icon name="index" size={11} />
          <span>Creates <code className="mono">idx_{cfg.table}_{cols.join('_')}</code></span>
        </div>
      )}
    </>
  );
}

// ---- code -----------------------------------------------------------------

function CoSqlForm({ cfg, set }) {
  return (
    <DFField label="SQL" hint="A single SELECT / WITH. The incoming stream is _input; extra inputs are _input2, _input3, …">
      <DFTextarea value={cfg.sql} onChange={v => set('sql', v)} rows={8} placeholder="SELECT * FROM _input" />
    </DFField>
  );
}

// ---- encryption -----------------------------------------------------------

function EnEncryptForm({ cfg, set }) {
  return (
    <>
      <DFField label="Plaintext source database"><ConnSelect value={cfg.conn} onChange={v => set('conn', v)} /></DFField>
      <DFField label="Encrypted output file"><DFText value={cfg.out_path} onChange={v => set('out_path', v)} placeholder="/path/to/encrypted.db" /></DFField>
      <DFField label="Key" hint="Passphrase or raw key x'…'. The source database is not modified.">
        <DFPassword value={cfg.key} onChange={v => set('key', v)} />
      </DFField>
    </>
  );
}

function EnDecryptForm({ cfg, set }) {
  return (
    <>
      <DFField label="Encrypted source database" hint="Must be open and unlocked in the app, or provide the key below."><ConnSelect value={cfg.conn} onChange={v => set('conn', v)} /></DFField>
      <DFField label="Plaintext output file"><DFText value={cfg.out_path} onChange={v => set('out_path', v)} placeholder="/path/to/plain.db" /></DFField>
      <DFField label="Key" hint="Optional when the database is already unlocked.">
        <DFPassword value={cfg.key} onChange={v => set('key', v)} />
      </DFField>
    </>
  );
}

function EnRekeyForm({ cfg, set }) {
  return (
    <>
      <DFField label="Database"><ConnSelect value={cfg.conn} onChange={v => set('conn', v)} /></DFField>
      <DFField label="New key" hint="Runs PRAGMA rekey on the connection. Full runs only.">
        <DFPassword value={cfg.new_key} onChange={v => set('new_key', v)} />
      </DFField>
    </>
  );
}

// ---- sinks ----------------------------------------------------------------

function SnkTableForm({ cfg, set }) {
  const n = Array.isArray(cfg.mappings) ? cfg.mappings.length : 0;
  return (
    <>
      <DFField label="Database"><ConnSelect value={cfg.conn} onChange={v => set('conn', v)} /></DFField>
      <DFField label="Target table" hint="Created automatically if it does not exist."><TableSelect conn={cfg.conn} value={cfg.table} onChange={v => set('table', v)} /></DFField>
      <DFField label="Write mode">
        <DFRadio value={cfg.write_mode || 'append'} options={[{ v: 'append', l: 'Append' }, { v: 'replace', l: 'Replace' }, { v: 'upsert', l: 'Upsert' }]} onChange={v => set('write_mode', v)} />
      </DFField>
      {cfg.write_mode === 'upsert' && (
        <DFField label="Key columns" hint="Comma-separated. A UNIQUE index is created on these if the table lacks one.">
          <DFText value={cfg.key} onChange={v => set('key', v)} mono placeholder="id" />
        </DFField>
      )}
      <DFField label="Batch size" hint="Rows per executemany chunk."><DFNumber value={cfg.batch_size ?? 500} min={1} onChange={v => set('batch_size', v)} /></DFField>
      {n > 0 && (
        <div className="df-explain">
          <Icon name="mapping" size={11} />
          <span>{n} column mapping{n === 1 ? '' : 's'} applied before writing (see the Mapping tab).</span>
        </div>
      )}
    </>
  );
}

function SnkExtDbForm({ cfg, set }) {
  return (
    <>
      <DFField label="Database file"><DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/other.db" /></DFField>
      <DFField label="Table"><DFText value={cfg.table} onChange={v => set('table', v)} mono placeholder="table_name" /></DFField>
      <DFField label="Key" hint="Leave blank for a plain SQLite file."><DFPassword value={cfg.key} onChange={v => set('key', v)} placeholder="passphrase (optional)" /></DFField>
      <DFField label="Write mode">
        <DFRadio value={cfg.write_mode || 'append'} options={[{ v: 'append', l: 'Append' }, { v: 'replace', l: 'Replace' }]} onChange={v => set('write_mode', v)} />
      </DFField>
    </>
  );
}

function SnkCsvForm({ cfg, set }) {
  return (
    <>
      <DFField label="Output path"><DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/output.csv" /></DFField>
      <DFField label="Delimiter"><DFText value={cfg.delimiter ?? ','} onChange={v => set('delimiter', v)} mono /></DFField>
      <DFField label="Write header row">{boolRadio(cfg.header, v => set('header', v))}</DFField>
    </>
  );
}

function SnkJsonForm({ cfg, set }) {
  return (
    <>
      <DFField label="Output path"><DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/output.json" /></DFField>
      <DFField label="Format"><DFRadio value={cfg.format || 'array'} options={[{ v: 'array', l: 'JSON array' }, { v: 'jsonl', l: 'JSON Lines' }]} onChange={v => set('format', v)} /></DFField>
    </>
  );
}

function SnkParquetForm({ cfg, set }) {
  return (
    <DFField label="Output path" hint="Requires the optional parquet extra.">
      <DFText value={cfg.path} onChange={v => set('path', v)} placeholder="/path/to/output.parquet" />
    </DFField>
  );
}

const FORMS = {
  'src-table': SrcTableForm,
  'src-view': SrcTableForm,
  'src-sql': SrcSqlForm,
  'src-csv': SrcCsvForm,
  'src-json': SrcJsonForm,
  'src-parquet': SrcParquetForm,
  'src-ext-db': SrcExtDbForm,
  'src-folder': SrcFolderForm,
  'tf-filter': TfFilterForm,
  'tf-project': TfProjectForm,
  'tf-rename': TfRenameForm,
  'tf-cast': TfCastForm,
  'tf-derive': TfDeriveForm,
  'tf-join': TfJoinForm,
  'tf-union': TfUnionForm,
  'tf-group': TfGroupForm,
  'tf-sort': TfSortForm,
  'tf-limit': TfLimitForm,
  'tf-map': TfMapForm,
  'cl-dedupe': ClDedupeForm,
  'cl-fill-null': ClFillNullForm,
  'cl-trim': ClTrimForm,
  'cl-case': ClCaseForm,
  'cl-anon': ClAnonForm,
  'cl-validate': ClValidateForm,
  'sc-add-col': ScAddColForm,
  'sc-drop-col': ScDropColForm,
  'sc-rename-col': ScRenameColForm,
  'sc-cast-col': ScCastColForm,
  'sc-add-index': ScAddIndexForm,
  'co-sql': CoSqlForm,
  'en-encrypt': EnEncryptForm,
  'en-decrypt': EnDecryptForm,
  'en-rekey': EnRekeyForm,
  'snk-table': SnkTableForm,
  'snk-ext-db': SnkExtDbForm,
  'snk-csv': SnkCsvForm,
  'snk-json': SnkJsonForm,
  'snk-parquet': SnkParquetForm,
};

// ---------------------------------------------------------------------------

export function DFInspectorConfig({ node }) {
  const updateNodeConfig = useDataFlowStore((s) => s.updateNodeConfig);
  const updateNodeSummary = useDataFlowStore((s) => s.updateNodeSummary);

  const def = DF_NODE_BY_KIND[node.kind];
  const cfg = node.config || {};
  const set = (key, val) => updateNodeConfig(node.id, { [key]: val });
  const Form = FORMS[node.kind];

  return (
    <div className="df-form">
      <DFField label="Summary" hint="Shown on the node card on the canvas.">
        <DFText value={node.summary} onChange={v => updateNodeSummary(node.id, v)} placeholder={def?.desc || 'Describe this step'} />
      </DFField>

      {def?.status === 'soon' ? (
        <div className="df-callout df-callout-warn">
          <Icon name="alert" size={13} />
          <div>
            <b>Not available yet</b>
            <div className="small">{def.name} nodes are on the roadmap. Validation flags them and runs stop at this node.</div>
          </div>
        </div>
      ) : Form ? (
        <Form node={node} cfg={cfg} set={set} />
      ) : null}

      {def?.family === 'schema' && (
        <div className="df-explain">
          <Icon name="info" size={11} />
          <span>Schema operations run in <b>Full run</b> only; preview and dry runs log the statement and pass rows through.</span>
        </div>
      )}
      {def?.family === 'encrypt' && (
        <div className="df-callout df-callout-encrypt">
          <Icon name="lock" size={13} />
          <span>Encryption steps run in <b>Full run</b> only and pass their input through unchanged.</span>
        </div>
      )}
    </div>
  );
}

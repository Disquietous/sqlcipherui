import { useEffect, useId, useState } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore, upstreamColumns } from '../../stores/dataflow';
import { getTableDetail } from '../../api/schema';

const cx = (...xs) => xs.filter(Boolean).join(' ');

/** Target columns for a SQLite table sink; derived from `{conn, table}` so it never syncs state in an effect. */
function useTargetColumns(conn, table, enabled) {
  const key = enabled && conn && table ? `${conn}::${table}` : null;
  const [result, setResult] = useState({ key: null, columns: [], failed: false });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    getTableDetail(table, conn)
      .then(d => { if (!cancelled) setResult({ key, columns: (d?.columns || []).map(c => ({ name: c.name, type: c.type || '', pk: !!c.pk })), failed: false }); })
      .catch(() => { if (!cancelled) setResult({ key, columns: [], failed: true }); });
    return () => { cancelled = true; };
  }, [key, conn, table]);

  const current = result.key === key;
  return {
    columns: current ? result.columns : [],
    failed: current ? result.failed : false,
    loading: !!key && !current,
  };
}

export function DFInspectorMapping({ node }) {
  const nodeColumns = useDataFlowStore((s) => s.nodeColumns);
  const nodeColumnsLoading = useDataFlowStore((s) => s.nodeColumnsLoading);
  const definition = useDataFlowStore((s) => s.pipeline?.definition);
  const setNodeConfig = useDataFlowStore((s) => s.setNodeConfig);
  const [selectedFrom, setSelectedFrom] = useState(null);
  const listId = useId();

  const cfg = node.config || {};
  const isSink = node.kind === 'snk-table';
  const mappings = Array.isArray(cfg.mappings) ? cfg.mappings.filter(m => m && typeof m === 'object') : [];
  const sources = upstreamColumns({ pipeline: { definition }, nodeColumns }, node.id);
  const target = useTargetColumns(cfg.conn, cfg.table, isSink);

  // For tf-map the target side is free text: it is whatever the mappings say.
  const targets = isSink && target.columns.length > 0
    ? target.columns
    : [...new Set(mappings.map(m => m.to).filter(Boolean))].map(name => ({ name, type: '' }));

  const save = (next) => setNodeConfig(node.id, { ...cfg, mappings: next });
  const mappedFrom = new Set(mappings.map(m => m.from));
  const mappedTo = new Set(mappings.map(m => m.to));

  const addMapping = (from, to) => {
    if (!from) return;
    const idx = mappings.findIndex(m => m.from === from);
    const next = idx >= 0
      ? mappings.map((m, i) => (i === idx ? { from, to } : m))
      : [...mappings, { from, to }];
    save(next);
    setSelectedFrom(null);
  };

  const autoMap = () => {
    const byLower = new Map(targets.map(t => [t.name.toLowerCase(), t.name]));
    const next = [...mappings];
    for (const s of sources) {
      if (next.some(m => m.from === s.name)) continue;
      const hit = isSink ? byLower.get(s.name.toLowerCase()) : s.name;
      if (hit) next.push({ from: s.name, to: hit });
    }
    save(next);
  };

  const clickSource = (name) => {
    if (!isSink) {
      // Map columns: one click creates a rename row seeded with the same name.
      if (!mappedFrom.has(name)) addMapping(name, name);
      return;
    }
    setSelectedFrom(selectedFrom === name ? null : name);
  };

  const clickTarget = (name) => {
    if (selectedFrom) addMapping(selectedFrom, name);
  };

  return (
    <div className="df-mapper">
      {sources.length === 0 && (
        <div className="df-explain">
          <Icon name="info" size={11} />
          <span>
            {nodeColumnsLoading
              ? 'Inferring upstream columns…'
              : 'No upstream columns known yet. Connect an input and save; the schema is inferred automatically. You can still type mappings below.'}
          </span>
        </div>
      )}

      <div className="df-mapping-head">
        <div className="df-mapping-side-head"><span>Source</span><span className="muted small">{sources.length} columns</span></div>
        <div></div>
        <div className="df-mapping-side-head">
          <span>Target</span>
          <span className="muted small">{isSink ? (target.loading ? 'loading…' : `${targets.length} columns`) : 'free text'}</span>
        </div>
      </div>

      <div className="df-mapping-grid">
        <div className="df-mapping-col" role="listbox" aria-label="Source columns">
          {sources.map(c => (
            <button
              type="button"
              key={c.name}
              role="option"
              aria-selected={selectedFrom === c.name}
              className={cx('df-map-row df-map-btn', mappedFrom.has(c.name) && 'is-mapped', selectedFrom === c.name && 'is-selected')}
              onClick={() => clickSource(c.name)}
              title={isSink ? 'Click, then click a target column' : 'Click to add a mapping'}
            >
              <span className="df-map-name mono">{c.name}</span>
              <span className="df-map-type mono muted small">{(c.type || '').toLowerCase()}</span>
              {mappedFrom.has(c.name) && <Icon name="check" size={10} />}
            </button>
          ))}
        </div>
        <div className="df-mapping-mid df-mapping-arrow"><Icon name="chevron-right" size={14} /></div>
        <div className="df-mapping-col" role="listbox" aria-label="Target columns">
          {isSink && target.failed && (
            <div className="muted small" style={{ padding: 6 }}>Could not read the target table's columns. Type target names in the rows below.</div>
          )}
          {targets.map(c => (
            <button
              type="button"
              key={c.name}
              role="option"
              aria-selected={false}
              className={cx('df-map-row df-map-btn', mappedTo.has(c.name) && 'is-mapped', selectedFrom && 'is-droppable')}
              onClick={() => clickTarget(c.name)}
              disabled={!isSink && !selectedFrom}
            >
              <span className="df-map-name mono">
                {c.pk && <Icon name="key" size={9} style={{ color: 'var(--accent)', marginRight: 4 }} />}
                {c.name}
              </span>
              <span className="df-map-type mono muted small">{(c.type || '').toLowerCase()}</span>
              {mappedTo.has(c.name) && <Icon name="check" size={10} />}
            </button>
          ))}
          {isSink && !target.loading && !target.failed && targets.length === 0 && (
            <div className="muted small" style={{ padding: 6 }}>
              {cfg.table ? 'The target table has no columns yet (it will be created on first run).' : 'Pick a target table in the Config tab.'}
            </div>
          )}
        </div>
      </div>

      <div className="df-map-rows">
        <div className="df-map-rows-h"><span>From</span><span></span><span>To</span><span></span></div>
        {mappings.length === 0 && <div className="muted small" style={{ padding: '6px 2px' }}>No mappings. Columns pass through with their original names.</div>}
        {mappings.map((m, i) => (
          <div key={i} className="df-map-rows-r">
            <input
              className="df-input df-input-compact mono"
              value={m.from ?? ''}
              list={sources.length ? listId : undefined}
              onChange={e => save(mappings.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
              aria-label="Source column"
              placeholder="source"
            />
            <Icon name="chevron-right" size={11} style={{ color: 'var(--text-3)' }} />
            <input
              className="df-input df-input-compact mono"
              value={m.to ?? ''}
              list={isSink && target.columns.length ? `${listId}-t` : undefined}
              onChange={e => save(mappings.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
              aria-label="Target column"
              placeholder="target"
            />
            <button type="button" className="iconbtn-sm" aria-label="Remove mapping" title="Remove" onClick={() => save(mappings.filter((_, j) => j !== i))}>
              <Icon name="close" size={10} />
            </button>
          </div>
        ))}
        <datalist id={listId}>{sources.map(c => <option key={c.name} value={c.name} />)}</datalist>
        <datalist id={`${listId}-t`}>{target.columns.map(c => <option key={c.name} value={c.name} />)}</datalist>
      </div>

      <div className="df-mapping-foot">
        <span className="muted small">
          {isSink && targets.length > 0
            ? `${targets.filter(t => mappedTo.has(t.name)).length} of ${targets.length} target columns mapped`
            : `${mappings.length} mapping${mappings.length === 1 ? '' : 's'}`}
        </span>
        <div style={{ flex: 1 }}></div>
        <button type="button" className="btn small" onClick={() => save([...mappings, { from: '', to: '' }])}><Icon name="plus" size={10} /> Row</button>
        <button type="button" className="btn small" onClick={autoMap} disabled={sources.length === 0}><Icon name="check" size={11} /> Auto-map by name</button>
        <button type="button" className="btn small" onClick={() => save([])} disabled={mappings.length === 0}>Clear all</button>
      </div>
    </div>
  );
}

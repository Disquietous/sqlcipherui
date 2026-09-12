import { useState } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore, upstreamColumns } from '../../stores/dataflow';
import { getSchema } from '../../api/dataflow';
import { isSourceKind } from './catalog';

const cx = (...xs) => xs.filter(Boolean).join(' ');

/** Compare a node's inferred columns against its first upstream node. */
function diffColumns(upstream, current) {
  const up = new Map(upstream.map(c => [c.name, c]));
  const cur = new Map(current.map(c => [c.name, c]));
  const out = current.map(c => {
    const prev = up.get(c.name);
    if (!prev) return { ...c, change: 'added' };
    if ((prev.type || '').toUpperCase() !== (c.type || '').toUpperCase()) return { ...c, change: 'changed', prevType: prev.type };
    return c;
  });
  const removed = upstream.filter(c => !cur.has(c.name)).map(c => ({ ...c, change: 'removed' }));
  return { out, removed };
}

export function DFInspectorSchema({ node }) {
  const nodeColumns = useDataFlowStore((s) => s.nodeColumns);
  const loading = useDataFlowStore((s) => s.nodeColumnsLoading);
  const definition = useDataFlowStore((s) => s.pipeline?.definition);
  const pipelineId = useDataFlowStore((s) => s.pipeline?.id);
  const [running, setRunning] = useState(false);

  const entry = nodeColumns[node.id];
  const columns = entry?.columns || [];
  const upstream = upstreamColumns({ pipeline: { definition }, nodeColumns }, node.id);
  const hasUpstream = !isSourceKind(node.kind) && (definition?.edges || []).some(e => e.to === node.id);

  const runInference = async () => {
    if (!pipelineId) return;
    const store = useDataFlowStore.getState();
    setRunning(true);
    store.setNodeColumnsLoading(true);
    try {
      store.setNodeColumns(await getSchema(pipelineId));
    } catch (e) {
      store.pushToast({ level: 'error', message: `Schema inference failed: ${e.message}` });
    } finally {
      useDataFlowStore.getState().setNodeColumnsLoading(false);
      setRunning(false);
    }
  };

  const busy = loading || running;

  if (!entry) {
    return (
      <div className="df-empty df-empty-plain">
        <Icon name="columns" size={16} />
        <div>{busy ? 'Inferring schema…' : 'No inferred schema for this node yet.'}</div>
        {!busy && (
          <>
            <div className="muted small">Schema is inferred automatically after each save. Run it now to see this node's output columns.</div>
            <button type="button" className="btn small" onClick={runInference} style={{ marginTop: 8 }}>
              <Icon name="refresh" size={10} /> Run schema inference
            </button>
          </>
        )}
      </div>
    );
  }

  const { out, removed } = diffColumns(upstream, columns);
  const counts = {
    added: out.filter(c => c.change === 'added').length,
    changed: out.filter(c => c.change === 'changed').length,
    removed: removed.length,
  };

  return (
    <div className="df-schema">
      <div className="df-schema-bar">
        <span className="pill pill-soft small">{columns.length} column{columns.length === 1 ? '' : 's'}</span>
        {hasUpstream && counts.added > 0 && <span className="df-diff-tag tag-added">+{counts.added} added</span>}
        {hasUpstream && counts.changed > 0 && <span className="df-diff-tag tag-changed">{counts.changed} changed</span>}
        {hasUpstream && counts.removed > 0 && <span className="df-diff-tag tag-removed">-{counts.removed} removed</span>}
        <div style={{ flex: 1 }}></div>
        <button type="button" className="link-btn small" onClick={runInference} disabled={busy}>
          {busy ? 'Inferring…' : 'Re-infer'}
        </button>
      </div>

      {entry.error && (
        <div className="df-callout df-callout-err">
          <Icon name="alert" size={13} />
          <div><b>Inference error</b><div className="small mono">{entry.error}</div></div>
        </div>
      )}

      {columns.length === 0 && !entry.error && (
        <div className="muted small">This node produced no columns during inference (empty input or a pass-through step with nothing upstream).</div>
      )}

      <div className="df-diff-list">
        {out.map(c => (
          <div key={c.name} className={cx('df-diff-row', c.change && `is-${c.change}`)}>
            <span className="mono">{c.name}</span>
            <span className="mono muted small">
              {c.change === 'changed' && <s style={{ marginRight: 4 }}>{(c.prevType || '').toLowerCase()}</s>}
              {(c.type || 'null').toLowerCase()}
            </span>
            {c.change && <span className={cx('df-diff-tag', `tag-${c.change}`)}>{c.change}</span>}
          </div>
        ))}
        {removed.map(c => (
          <div key={`rm-${c.name}`} className="df-diff-row is-removed">
            <span className="mono"><s>{c.name}</s></span>
            <span className="mono muted small">{(c.type || '').toLowerCase()}</span>
            <span className="df-diff-tag tag-removed">removed</span>
          </div>
        ))}
      </div>

      {hasUpstream && upstream.length === 0 && (
        <div className="muted small">Upstream columns are unknown, so no delta is shown.</div>
      )}
    </div>
  );
}

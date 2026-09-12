import { Fragment, useState } from 'react';
import { useDataFlowStore } from '../../stores/dataflow';
import { previewNode } from '../../api/dataflow';
import { Icon } from '../icons/Icon';

/** Preview columns are `{name, type}`; tolerate legacy plain-string lists. */
function normalizeColumns(cols) {
  if (!Array.isArray(cols)) return [];
  return cols.map(c => (typeof c === 'string' ? { name: c, type: '' } : c)).filter(c => c && c.name);
}

function formatCell(v) {
  if (v === null || v === undefined) return { text: 'NULL', isNull: true };
  if (typeof v === 'object') return { text: JSON.stringify(v) };
  return { text: String(v) };
}

export function DFInspectorPreview({ node }) {
  const pipelineId = useDataFlowStore((s) => s.pipeline?.id);
  const data = useDataFlowStore((s) => s.previewData[node.id]);
  const setPreviewData = useDataFlowStore((s) => s.setPreviewData);
  const [loading, setLoading] = useState(false);
  const [sampleSize, setSampleSize] = useState(5);

  const cols = normalizeColumns(data?.columns);
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const error = data?.error || null;

  const refresh = async () => {
    if (!pipelineId) return;
    setLoading(true);
    try {
      setPreviewData(node.id, await previewNode(pipelineId, node.id, sampleSize));
    } catch (e) {
      setPreviewData(node.id, { columns: [], rows: [], error: e.message });
      useDataFlowStore.getState().pushToast({ level: 'error', message: `Preview failed: ${e.message}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="df-insp-preview">
      <div className="df-insp-preview-bar">
        <span className="pill pill-soft small">sample &middot; {rows.length} row{rows.length === 1 ? '' : 's'}</span>
        <select
          className="df-input df-input-compact"
          style={{ width: 'auto' }}
          value={sampleSize}
          onChange={e => setSampleSize(Number(e.target.value))}
          aria-label="Sample size"
        >
          {[5, 20, 100].map(n => <option key={n} value={n}>{n} rows</option>)}
        </select>
        <div style={{ flex: 1 }}></div>
        <button type="button" className="link-btn small" onClick={refresh} disabled={loading}>
          {loading ? 'Loading…' : data ? 'Refresh sample' : 'Load sample'}
        </button>
      </div>

      {error && (
        <div className="df-callout df-callout-err" role="alert">
          <Icon name="alert" size={13} />
          <div><b>Preview error</b><div className="small mono">{error}</div></div>
        </div>
      )}

      {cols.length > 0 ? (
        <div className="grid-wrap">
          <div className="grid" style={{ gridTemplateColumns: `32px ${cols.map(() => 'minmax(96px,1fr)').join(' ')}` }}>
            <div className="gh gh-num">#</div>
            {cols.map(c => (
              <div key={c.name} className="gh" title={c.type ? `${c.name} · ${c.type}` : c.name}>
                <span className="gh-name">{c.name}</span>
                {c.type && <span className="df-gh-type mono">{c.type.toLowerCase()}</span>}
              </div>
            ))}
            {rows.map((row, ri) => (
              <Fragment key={ri}>
                <div className="gc gc-num">{ri + 1}</div>
                {cols.map((c) => {
                  const cell = formatCell(row[c.name]);
                  return (
                    <div key={c.name} className="gc">
                      <span className={cell.isNull ? 'cell-text mono muted' : 'cell-text mono'}>{cell.text}</span>
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      ) : !error && (
        <div className="df-empty df-empty-plain">
          <Icon name="eye" size={18} />
          <div>{data ? 'The sample returned no rows.' : 'Load a sample to preview this node’s output.'}</div>
          <div className="muted small">Runs the pipeline up to this node in preview mode; nothing is written.</div>
        </div>
      )}
    </div>
  );
}

import { Fragment, useState } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { DF_NODE_BY_KIND } from './catalog';
import { previewNode } from '../../api/dataflow';
import { forceSave } from './useRunController';

const SAMPLE_SIZES = [5, 20, 100];

const colName = (c) => (typeof c === 'string' ? c : c?.name ?? '');
const colType = (c) => (typeof c === 'string' ? '' : c?.type ?? '');

function cellText(v) {
  if (v === null || v === undefined) return { text: 'NULL', isNull: true };
  if (typeof v === 'object') return { text: JSON.stringify(v), isNull: false };
  return { text: String(v), isNull: false };
}

export function DFDockPreview({ node }) {
  const pipeline = useDataFlowStore((s) => s.pipeline);
  const previewData = useDataFlowStore((s) => s.previewData);
  const setPreviewData = useDataFlowStore((s) => s.setPreviewData);
  const pushToast = useDataFlowStore((s) => s.pushToast);
  const [loading, setLoading] = useState(false);
  const [sampleSize, setSampleSize] = useState(5);

  const data = node ? previewData[node.id] : null;
  const cols = data?.columns || [];
  const rows = data?.rows || [];
  const error = data?.error || null;

  const refresh = async () => {
    if (!pipeline?.id || !node?.id) return;
    setLoading(true);
    try {
      const ok = await forceSave();
      if (!ok) return;
      const result = await previewNode(pipeline.id, node.id, sampleSize);
      setPreviewData(node.id, result);
    } catch (err) {
      setPreviewData(node.id, { columns: [], rows: [], error: err.message });
      pushToast({ level: 'error', message: `Preview failed: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  if (!node) {
    return (
      <div className="df-dock-preview df-dock-preview-empty">
        Select a node to preview its output.
      </div>
    );
  }

  const def = DF_NODE_BY_KIND[node.kind];

  return (
    <div className="df-dock-preview">
      <div className="df-dock-preview-side">
        <div className="muted small" style={{ marginBottom: 6 }}>Scoped to</div>
        <div className={`df-node-ic family-${def?.family || 'code'}`} style={{ display: 'inline-flex', marginBottom: 4 }}>
          <Icon name={def?.icon || 'dot'} size={11} />
        </div>
        <div className="small">{def?.name}</div>
        <div className="mono small muted">{node.id}</div>
        <div className="df-dock-preview-stats">
          <div><span className="muted small">rows</span><b className="mono">{rows.length}</b></div>
          <div><span className="muted small">columns</span><b className="mono">{cols.length}</b></div>
        </div>
        <label className="df-dock-preview-sample">
          <span className="muted small">Sample</span>
          <select className="df-input df-input-compact" value={sampleSize} aria-label="Sample size"
                  onChange={(e) => setSampleSize(Number(e.target.value))}>
            {SAMPLE_SIZES.map(n => <option key={n} value={n}>{n} rows</option>)}
          </select>
        </label>
        <button className="tb-btn small" onClick={refresh} disabled={loading} style={{ marginTop: 8 }}>
          <Icon name={loading ? 'loader' : 'play'} size={10} />
          <span>{loading ? 'Loading…' : (data ? 'Refresh' : 'Load preview')}</span>
        </button>
      </div>

      <div className="df-dock-preview-main">
        {error && (
          <div className="df-preview-error" role="alert">
            <Icon name="alert" size={12} />
            <span className="mono">{error}</span>
          </div>
        )}
        {cols.length > 0 ? (
          <div className="grid-wrap">
            <div className="grid" style={{ gridTemplateColumns: `32px ${cols.map(() => 'minmax(110px,1fr)').join(' ')}` }}>
              <div className="gh gh-num">#</div>
              {cols.map((c, ci) => (
                <div key={`${colName(c)}-${ci}`} className="gh">
                  <span className="gh-name">{colName(c)}</span>
                  {colType(c) && <span className="gh-type">{colType(c)}</span>}
                </div>
              ))}
              {rows.map((row, ri) => (
                <Fragment key={ri}>
                  <div className="gc gc-num">{ri + 1}</div>
                  {cols.map((c, ci) => {
                    const name = colName(c);
                    const v = Array.isArray(row) ? row[ci] : row[name];
                    const { text, isNull } = cellText(v);
                    return (
                      <div key={`${name}-${ci}`} className="gc">
                        <span className={`cell-text mono${isNull ? ' is-null' : ''}`}>{text}</span>
                      </div>
                    );
                  })}
                </Fragment>
              ))}
              {rows.length === 0 && (
                <div className="gc df-preview-norows" style={{ gridColumn: `1 / span ${cols.length + 1}` }}>No rows</div>
              )}
            </div>
          </div>
        ) : !error && (
          <div className="df-dock-preview-empty">
            {loading ? 'Loading preview…' : 'Click "Load preview" to sample this node\'s output.'}
          </div>
        )}
      </div>
    </div>
  );
}

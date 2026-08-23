import { Fragment, useEffect, useState } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { DF_NODE_BY_KIND } from './catalog';
import { previewNode } from '../../api/dataflow';

export function DFDockPreview({ node }) {
  const pipeline = useDataFlowStore((s) => s.pipeline);
  const previewData = useDataFlowStore((s) => s.previewData);
  const setPreviewData = useDataFlowStore((s) => s.setPreviewData);
  const [loading, setLoading] = useState(false);

  const data = node ? previewData[node.id] : null;
  const cols = data?.columns || [];
  const rows = data?.rows || [];

  const refresh = () => {
    if (!pipeline?.id || !node?.id) return;
    setLoading(true);
    previewNode(pipeline.id, node.id)
      .then((result) => {
        setPreviewData(node.id, result);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  if (!node) {
    return (
      <div className="df-dock-preview" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: '0.923em' }}>
        Select a node to preview its output.
      </div>
    );
  }

  return (
    <div className="df-dock-preview">
      <div className="df-dock-preview-side">
        <div className="muted small" style={{ marginBottom: 6 }}>Scoped to</div>
        <div className="df-node-ic" style={{ display: 'inline-flex', marginBottom: 4 }}>
          <Icon name={DF_NODE_BY_KIND[node.kind]?.icon || 'dot'} size={11} />
        </div>
        <div className="mono small">{node.id}</div>
        <div className="df-dock-preview-stats">
          <div><span className="muted small">sample</span><b className="mono">{rows.length} rows</b></div>
        </div>
        <button className="tb-btn small" onClick={refresh} disabled={loading} style={{ marginTop: 8 }}>
          <Icon name={loading ? 'loader' : 'play'} size={10} />
          <span>{loading ? 'Loading…' : 'Refresh'}</span>
        </button>
      </div>
      {cols.length > 0 ? (
        <div className="grid-wrap">
          <div className="grid" style={{ gridTemplateColumns: `32px ${cols.map(() => 'minmax(110px,1fr)').join(' ')}` }}>
            <div className="gh gh-num">#</div>
            {cols.map(c => <div key={c} className="gh"><span className="gh-name">{c}</span></div>)}
            {rows.map((row, ri) => (
              <Fragment key={ri}>
                <div className="gc gc-num">{ri + 1}</div>
                {cols.map((c) => (
                  <div key={c} className="gc"><span className="cell-text mono">{String(row[c] ?? '')}</span></div>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: '0.923em' }}>
          Click Refresh to load preview data.
        </div>
      )}
    </div>
  );
}

import { Fragment, useState } from 'react';
import { useDataFlowStore } from '../../stores/dataflow';
import { previewNode } from '../../api/dataflow';
import { Icon } from '../icons/Icon';

export function DFInspectorPreview({ node }) {
  const pipeline = useDataFlowStore((s) => s.pipeline);
  const previewData = useDataFlowStore((s) => s.previewData);
  const setPreviewData = useDataFlowStore((s) => s.setPreviewData);
  const [loading, setLoading] = useState(false);

  const data = previewData[node.id];
  const cols = data?.columns || [];
  const rows = data?.rows || [];

  const refresh = () => {
    if (!pipeline?.id) return;
    setLoading(true);
    previewNode(pipeline.id, node.id)
      .then((result) => setPreviewData(node.id, result))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  return (
    <div className="df-insp-preview">
      <div className="df-insp-preview-bar">
        <span className="pill pill-soft small">sample &middot; {rows.length} rows</span>
        <div style={{ flex: 1 }}></div>
        <button className="link-btn small" onClick={refresh} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh sample'}
        </button>
      </div>
      {cols.length > 0 ? (
        <div className="grid-wrap">
          <div className="grid" style={{ gridTemplateColumns: `32px ${cols.map(() => 'minmax(96px,1fr)').join(' ')}` }}>
            <div className="gh gh-num">#</div>
            {cols.map(c => <div key={c} className="gh"><span className="gh-name">{c}</span></div>)}
            {rows.map((row, ri) => (
              <Fragment key={ri}>
                <div className="gc gc-num">{ri + 1}</div>
                {cols.map((c) => (
                  <div key={c} className="gc">
                    <span className="cell-text mono">{String(row[c] ?? '')}</span>
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: '1em' }}>
          <Icon name="eye" size={20} style={{ opacity: 0.3, marginBottom: 8 }} />
          <div>Click "Refresh sample" to preview this node's output.</div>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { validatePipeline } from '../../api/dataflow';

const cx = (...xs) => xs.filter(Boolean).join(' ');

export function DFDockIssues() {
  const pipeline = useDataFlowStore((s) => s.pipeline);
  const selectNode = useDataFlowStore((s) => s.selectNode);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleValidate = () => {
    if (!pipeline?.id) return;
    setLoading(true);
    validatePipeline(pipeline.id)
      .then((result) => setIssues(Array.isArray(result) ? result : result.issues || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  return (
    <div className="df-issues" style={{ padding: 12 }}>
      <div style={{ marginBottom: 12 }}>
        <button className="tb-btn small" onClick={handleValidate} disabled={loading}>
          <Icon name={loading ? 'loader' : 'shield'} size={10} />
          <span>{loading ? 'Validating…' : 'Validate pipeline'}</span>
        </button>
      </div>
      {issues.length === 0 && !loading && (
        <div style={{ color: 'var(--text-3)', fontSize: '0.923em', textAlign: 'center', padding: 12 }}>
          {pipeline?.id ? 'Click "Validate pipeline" to check for issues.' : 'No pipeline loaded.'}
        </div>
      )}
      {issues.map((issue, i) => (
        <div key={i} className={cx('df-issue', `df-issue-${issue.level || 'warn'}`)}>
          <Icon name={issue.level === 'error' ? 'alert' : 'dot'} size={12} />
          <div>
            <b>{issue.node_id ? `${issue.node_id} — ` : ''}{issue.message}</b>
            {issue.detail && <p>{issue.detail}</p>}
            {issue.node_id && (
              <div className="df-issue-actions">
                <button className="link-btn small" onClick={() => selectNode(issue.node_id)}>Jump to node</button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

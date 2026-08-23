import { useState, useEffect } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { validatePipeline } from '../../api/dataflow';

export function DFInspectorIssues({ node }) {
  const pipeline = useDataFlowStore((s) => s.pipeline);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pipeline?.id || !node?.id) return;
    setLoading(true);
    validatePipeline(pipeline.id)
      .then(result => {
        const all = Array.isArray(result) ? result : result?.issues || [];
        setIssues(all.filter(i => i.node_id === node.id));
      })
      .catch(() => setIssues([]))
      .finally(() => setLoading(false));
  }, [pipeline?.id, node?.id]);

  if (loading) {
    return <div className="df-empty"><span className="muted">Checking…</span></div>;
  }

  if (issues.length === 0) {
    return (
      <div className="df-empty">
        <Icon name="check" size={14} /><br />
        No issues detected on this node.
      </div>
    );
  }

  return (
    <div className="df-issues">
      {issues.map((issue, i) => (
        <div key={i} className={`df-issue df-issue-${issue.level || 'warn'}`}>
          <Icon name={issue.level === 'info' ? 'dot' : 'alert'} size={12} />
          <div>
            <b>{issue.message}</b>
            {issue.detail && <p>{issue.detail}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

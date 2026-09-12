import { useState } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { DF_NODE_BY_KIND } from './catalog';
import { useRunController } from './useRunController';

const cx = (...xs) => xs.filter(Boolean).join(' ');

export function DFDockIssues() {
  const pipeline = useDataFlowStore((s) => s.pipeline);
  const issues = useDataFlowStore((s) => s.validationIssues);
  const selectNode = useDataFlowStore((s) => s.selectNode);
  const setInspectorOpen = useDataFlowStore((s) => s.setInspectorOpen);
  const { runValidation } = useRunController();
  const [loading, setLoading] = useState(false);
  const [validated, setValidated] = useState(false);

  const handleValidate = async () => {
    if (!pipeline?.id) return;
    setLoading(true);
    const res = await runValidation({ quiet: true });
    setLoading(false);
    if (res !== null) setValidated(true);
  };

  const jump = (nodeId) => {
    selectNode(nodeId);
    setInspectorOpen(true);
    document.querySelector(`.df-node[data-node-id="${nodeId}"]`)?.focus({ preventScroll: true });
  };

  const nodeLabel = (nodeId) => {
    const n = pipeline?.definition?.nodes?.find(x => x.id === nodeId);
    const def = n && DF_NODE_BY_KIND[n.kind];
    return def ? `${def.name} (${nodeId})` : nodeId;
  };

  const errors = issues.filter(i => i.level === 'error').length;
  const warns = issues.length - errors;

  return (
    <div className="df-issues df-dock-issues">
      <div className="df-dock-issues-bar">
        <button className="tb-btn small" onClick={handleValidate} disabled={loading || !pipeline?.id}>
          <Icon name={loading ? 'loader' : 'shield'} size={10} />
          <span>{loading ? 'Validating…' : 'Validate pipeline'}</span>
        </button>
        {issues.length > 0 && (
          <span className="muted small">
            {errors} error{errors === 1 ? '' : 's'}, {warns} warning{warns === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {issues.length === 0 && !loading && (
        <div className="df-dock-issues-empty">
          {!pipeline?.id
            ? 'No pipeline loaded.'
            : validated
              ? <><Icon name="check" size={14} /> No issues found.</>
              : 'Click "Validate pipeline" to check for issues.'}
        </div>
      )}
      {issues.map((issue, i) => (
        <div key={i} className={cx('df-issue', `df-issue-${issue.level || 'warn'}`)}>
          <Icon name={issue.level === 'error' ? 'alert' : issue.level === 'info' ? 'dot' : 'warning-triangle'} size={12} />
          <div>
            <b>{issue.node_id ? `${nodeLabel(issue.node_id)} — ` : ''}{issue.message}</b>
            {issue.detail && <p>{issue.detail}</p>}
            {issue.node_id && (
              <div className="df-issue-actions">
                <button className="link-btn small" onClick={() => jump(issue.node_id)}>Jump to node</button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

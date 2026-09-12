import { Icon } from '../icons/Icon';

const cx = (...xs) => xs.filter(Boolean).join(' ');

const LEVEL_ICON = { error: 'alert', warn: 'warning-triangle', info: 'info' };

/**
 * Issues for one node. Validation itself is owned by DFInspector so the tab
 * count badge stays correct even when this tab is not mounted.
 */
export function DFInspectorIssues({ issues, loading, error = null, stale, onRevalidate }) {
  return (
    <div className="df-issues-wrap">
      <div className="df-insp-preview-bar">
        {stale
          ? <span className="pill small" title="Unsaved changes; results reflect the last saved definition">unsaved changes</span>
          : <span className="pill pill-soft small">{issues.length} issue{issues.length === 1 ? '' : 's'} on this node</span>}
        <div style={{ flex: 1 }}></div>
        <button type="button" className="link-btn small" onClick={onRevalidate} disabled={loading}>
          {loading ? 'Validating…' : 'Validate pipeline'}
        </button>
      </div>

      {error && (
        <div className="df-callout df-callout-err" role="alert">
          <Icon name="alert" size={13} />
          <div><b>Validation failed</b><div className="small mono">{error}</div></div>
        </div>
      )}

      {!error && !loading && issues.length === 0 && (
        <div className="df-empty">
          <Icon name="check" size={14} /><br />
          No issues detected on this node.
        </div>
      )}

      {issues.length > 0 && (
        <div className="df-issues">
          {issues.map((issue, i) => {
            const level = issue.level === 'error' ? 'error' : issue.level === 'info' ? 'info' : 'warn';
            return (
              <div key={i} className={cx('df-issue', `df-issue-${level}`)}>
                <Icon name={LEVEL_ICON[level]} size={12} />
                <div className="df-issue-body">
                  <span className={cx('df-level-pill', `is-${level}`)}>{level}</span>
                  <span>{issue.message}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

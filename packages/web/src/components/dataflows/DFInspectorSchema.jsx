import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';

const cx = (...xs) => xs.filter(Boolean).join(' ');

export function DFInspectorSchema({ node }) {
  const nodeColumns = useDataFlowStore((s) => s.nodeColumns);
  const cols = nodeColumns[node.id];

  if (!cols) {
    return <div className="df-empty">No schema delta for this node — pass-through.</div>;
  }

  return (
    <div className="df-schema-diff">
      <div className="df-diff-side">
        <div className="df-diff-h">Input &middot; {cols.in?.length || 0} cols</div>
        <div className="df-diff-list">
          {(cols.in || []).map(c => (
            <div key={c.name} className="df-diff-row">
              <span className="mono">{c.name}</span>
              <span className="mono muted small">{c.type.toLowerCase()}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="df-diff-mid"><Icon name="chevron-right" size={14} /></div>
      <div className="df-diff-side">
        <div className="df-diff-h">Output &middot; {cols.out?.length || 0} cols</div>
        <div className="df-diff-list">
          {(cols.out || []).map(c => (
            <div key={c.name} className={cx('df-diff-row', c.changed && `is-${c.changed}`)}>
              <span className="mono">
                {c.pk && <Icon name="key" size={9} style={{ color: 'var(--accent)', marginRight: 4 }} />}
                {c.name}
              </span>
              <span className="mono muted small">{c.type.toLowerCase()}</span>
              {c.changed && <span className={cx('df-diff-tag', `tag-${c.changed}`)}>{c.changed}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

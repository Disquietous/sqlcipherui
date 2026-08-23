import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { createDfConnection, deleteDfConnection, getDfConnections } from '../../api/dataflow';

const cx = (...xs) => xs.filter(Boolean).join(' ');

export function DFConnectionsPanel({ onClose }) {
  const dfConnections = useDataFlowStore((s) => s.dfConnections);
  const setDfConnections = useDataFlowStore((s) => s.setDfConnections);

  const handleRemove = async (id) => {
    try {
      await deleteDfConnection(id);
      const updated = await getDfConnections();
      setDfConnections(updated);
    } catch (e) {
      /* ignore */
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 640, textAlign: 'left', padding: 0 }} onClick={e => e.stopPropagation()}>
        <div className="df-mod-head">
          <Icon name="database" size={16} style={{ color: 'var(--accent)' }} />
          <h3 className="modal-title" style={{ margin: 0 }}>Connections</h3>
          <div style={{ flex: 1 }}></div>
          <button className="btn btn-primary small"><Icon name="plus" size={10} /> Add connection</button>
          <button className="iconbtn-sm" onClick={onClose}><Icon name="close" size={12} /></button>
        </div>
        <div className="df-conn-list">
          <div className="df-conn-h">
            <div>Name</div><div>Type</div><div>Path</div><div>Status</div><div></div>
          </div>
          {dfConnections.map(c => (
            <div key={c.id} className="df-conn-row">
              <div className="df-conn-name">
                <Icon name={c.kind === 'folder' ? 'folder' : c.kind === 'csv' ? 'file-csv' : 'database'} size={12} />
                <span>{c.name}</span>
                {c.encrypted && <span className="df-conn-lock"><Icon name="lock" size={9} /></span>}
              </div>
              <div className="mono small muted">{c.kind}</div>
              <div className="mono small muted" title={c.path}>{c.path}</div>
              <div>
                <span className={cx('pill small',
                  c.status === 'unlocked' || c.status === 'open' ? 'pill-ok' :
                  c.status === 'closed' ? 'pill-soft' :
                  'pill-soft')}>{c.status}</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="iconbtn-sm" title="Edit"><Icon name="edit" size={11} /></button>
                <button className="iconbtn-sm" title="Remove" onClick={() => handleRemove(c.id)}><Icon name="close" size={11} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

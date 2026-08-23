import { Icon } from '../icons/Icon';
import { useConnectionStore } from '../../stores/connection';

export function StatusBar() {
  const connections = useConnectionStore((s) => s.connections);
  const activeDbId = useConnectionStore((s) => s.activeDbId);
  const dbInfo = connections[activeDbId] || null;
  const isConnected = Object.keys(connections).length > 0;

  return (
    <div className="status">
      {isConnected && dbInfo ? (
        <>
          <span className="status-item"><Icon name="lock" size={11} /> {dbInfo.encrypted ? 'SQLCipher' : 'SQLite'}</span>
          <span className="status-item"><Icon name="database" size={11} /> {dbInfo.name}</span>
          <span className="status-item">{dbInfo.size_display || '—'}</span>
          <span className="status-item">{dbInfo.journal_mode?.toUpperCase() || '—'}</span>
          <div style={{ flex: 1 }}></div>
          <span className="status-item">UTF-8</span>
          <span className="status-item">SQLite 3.x · SQLCipher</span>
          <span className="status-item ok"><span className="dot ok"></span>connected</span>
        </>
      ) : (
        <>
          <span className="status-item" style={{ color: 'var(--text-3)' }}>No database open</span>
          <div style={{ flex: 1 }}></div>
        </>
      )}
    </div>
  );
}

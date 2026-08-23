import { useState, useEffect, useRef } from 'react';
import { Icon } from '../icons/Icon';
import { openDatabase, browseDirectory } from '../../api/database';
import { getDatabases, addDatabase, removeDatabase } from '../../api/app';
import { useConnectionStore } from '../../stores/connection';

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DatabaseDropdown({ onClose, onNeedUnlock, onCreateNew }) {
  const [view, setView] = useState('databases');
  const [databases, setDatabases] = useState([]);
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState(null);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const addConnection = useConnectionStore((s) => s.addConnection);
  const ref = useRef(null);

  useEffect(() => {
    getDatabases().then(setDatabases).catch(() => {});
  }, []);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        onClose();
      }
    };
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  const browse = async (path = '') => {
    setBrowsing(true);
    setError(null);
    setSelected(null);
    try {
      const res = await browseDirectory(path);
      setCurrentPath(res.path);
      setParentPath(res.parent);
      setItems(res.items);
      setView('browse');
    } catch (e) {
      setError(e.message);
    } finally {
      setBrowsing(false);
    }
  };

  const handleOpen = async (filePath) => {
    const target = filePath || selected;
    if (!target) return;
    setError(null);
    setLoading(true);
    try {
      const info = await openDatabase(target);
      addConnection(info);
      const name = target.split('/').pop();
      addDatabase(target, name).catch(() => {});
      getDatabases().then(setDatabases).catch(() => {});
      if (info.encrypted && !info.unlocked) {
        onNeedUnlock(info.path);
      } else {
        onClose();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveDb = async (e, id) => {
    e.stopPropagation();
    await removeDatabase(id).catch(() => {});
    setDatabases(prev => prev.filter(d => d.id !== id));
  };

  const handleItemClick = (item) => {
    if (item.is_dir) {
      browse(item.path);
    } else {
      setSelected(item.path);
    }
  };

  const handleItemDblClick = (item) => {
    if (item.is_dir) {
      browse(item.path);
    } else {
      handleOpen(item.path);
    }
  };

  return (
    <div className="db-dropdown" ref={ref}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Icon name="database" size={18} />
        <h3 style={{ margin: 0, fontSize: '1.154em', fontWeight: 600, flex: 1 }}>Open database</h3>
        <button className="btn btn-xs btn-primary" onClick={() => { onClose(); onCreateNew(); }} style={{ marginRight: 4 }}>
          <Icon name="plus" size={10} /> New
        </button>
        <div className="mode-switch">
          <button
            className={`mode-btn${view === 'databases' ? ' is-on' : ''}`}
            onClick={() => setView('databases')}
          >
            <Icon name="database" size={11} /><span>Databases</span>
          </button>
          <button
            className={`mode-btn${view === 'browse' ? ' is-on' : ''}`}
            onClick={() => { if (view !== 'browse') browse(); }}
          >
            <Icon name="folder" size={11} /><span>Browse</span>
          </button>
        </div>
      </div>

      {view === 'databases' && (
        <div className="browser-list">
          {databases.length === 0 && (
            <div className="muted small" style={{ padding: 16 }}>No databases opened yet.</div>
          )}
          {databases.map((db) => (
            <div
              key={db.id}
              className="browser-item is-db"
              style={{ cursor: 'pointer' }}
              onClick={() => handleOpen(db.path)}
            >
              <Icon name="database" size={14} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="browser-name">{db.name}</div>
                <div className="mono" style={{ fontSize: '0.769em', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{db.path}</div>
              </div>
              <button
                className="iconbtn-sm"
                title="Remove"
                onClick={(e) => handleRemoveDb(e, db.id)}
                style={{ opacity: 0.4 }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
                onMouseLeave={(e) => e.currentTarget.style.opacity = 0.4}
              >
                <Icon name="close" size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {view === 'browse' && (
        <>
          <div className="browser-path">
            {parentPath && (
              <button className="browser-up" onClick={() => browse(parentPath)} title="Up">
                <Icon name="chevron-right" size={12} style={{ transform: 'rotate(180deg)' }} />
              </button>
            )}
            <span className="mono small" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentPath}
            </span>
          </div>

          <div className="browser-list">
            {browsing && items.length === 0 && (
              <div className="muted small" style={{ padding: 16 }}>Loading...</div>
            )}
            {items.map((item) => (
              <div
                key={item.path}
                className={`browser-item${selected === item.path ? ' is-selected' : ''}${item.is_db ? ' is-db' : ''}`}
                onClick={() => handleItemClick(item)}
                onDoubleClick={() => handleItemDblClick(item)}
              >
                <Icon name={item.is_dir ? 'folder' : 'file'} size={14} />
                <span className="browser-name">{item.name}</span>
                {!item.is_dir && (
                  <span className="browser-size mono">{formatSize(item.size)}</span>
                )}
              </div>
            ))}
            {!browsing && items.length === 0 && (
              <div className="muted small" style={{ padding: 16 }}>Empty directory</div>
            )}
          </div>
        </>
      )}

      {error && <div style={{ color: 'var(--err)', fontSize: '0.923em', marginTop: 8 }}>{error}</div>}

      {view === 'browse' && selected && (
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={() => handleOpen()} disabled={loading}>
            {loading ? 'Opening...' : 'Open'}
          </button>
        </div>
      )}
    </div>
  );
}

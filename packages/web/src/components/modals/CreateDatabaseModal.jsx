import { useState } from 'react';
import { Icon } from '../icons/Icon';
import { createDatabase, browseDirectory } from '../../api/database';
import { addDatabase } from '../../api/app';
import { useConnectionStore } from '../../stores/connection';

const cx = (...xs) => xs.filter(Boolean).join(' ');

function formatKeyForApi(value, hexMode) {
  if (hexMode) {
    const hex = value.replace(/\s/g, '').toLowerCase();
    return `x'${hex}'`;
  }
  return value;
}

export function CreateDatabaseModal({ onClose }) {
  const [dbType, setDbType] = useState('sqlite');
  const [directory, setDirectory] = useState('');
  const [fileName, setFileName] = useState('');
  const [hexMode, setHexMode] = useState(false);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [browseItems, setBrowseItems] = useState([]);
  const [browsePath, setBrowsePath] = useState('');
  const [browseParent, setBrowseParent] = useState(null);
  const addConnection = useConnectionStore((s) => s.addConnection);

  const isEncrypted = dbType === 'sqlcipher';

  const openBrowser = async (path = '') => {
    setBrowsing(true);
    try {
      const res = await browseDirectory(path);
      setBrowseItems(res.items.filter(i => i.is_dir));
      setBrowsePath(res.path);
      setBrowseParent(res.parent);
      setDirectory(res.path);
    } catch (e) {
      setError(e.message);
    } finally {
      setBrowsing(false);
    }
  };

  const handleCreate = async () => {
    if (!directory || !fileName) return;

    const name = fileName.includes('.') ? fileName : fileName + '.db';
    const fullPath = directory.replace(/\/$/, '') + '/' + name;

    if (isEncrypted) {
      if (!pass) { setError('Passphrase is required'); return; }
      if (hexMode) {
        const hex = pass.replace(/\s/g, '');
        if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
          setError('Hex key must be exactly 64 hex characters (256-bit key)');
          return;
        }
      }
      if (pass !== confirm) { setError('Passphrases do not match'); return; }
    }

    setError(null);
    setLoading(true);
    try {
      const passphrase = isEncrypted ? formatKeyForApi(pass, hexMode) : null;
      const info = await createDatabase(fullPath, isEncrypted, passphrase);
      addConnection(info);
      addDatabase(info.path, name).catch(() => {});
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const canCreate = directory && fileName && (!isEncrypted || (pass && pass === confirm));
  const showBrowser = browseItems.length > 0 || browsing;

  return (
    <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 400, textAlign: 'left' }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div className="modal-ic"><Icon name="database" size={22} /></div>
          <h3 className="modal-title">Create new database</h3>
        </div>

        <label className="lbl">Type</label>
        <div className="btn-row" style={{ marginBottom: 14 }}>
          <button className={cx('btn btn-xs', dbType === 'sqlite' && 'btn-primary')} onClick={() => setDbType('sqlite')}>
            <Icon name="database" size={10} /> SQLite
          </button>
          <button className={cx('btn btn-xs', dbType === 'sqlcipher' && 'btn-primary')} onClick={() => setDbType('sqlcipher')}>
            <Icon name="lock" size={10} /> SQLCipher
          </button>
        </div>

        <label className="lbl">Location</label>
        <div className="field-row" style={{ marginBottom: showBrowser ? 0 : 14, borderBottomLeftRadius: showBrowser ? 0 : undefined, borderBottomRightRadius: showBrowser ? 0 : undefined }}>
          <input
            className="field-input mono"
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            placeholder="/path/to/directory"
            spellCheck={false}
            style={{ fontSize: '0.923em' }}
          />
          <button className="iconbtn" onClick={() => openBrowser(directory || '')} title="Browse">
            <Icon name="folder" size={14} />
          </button>
        </div>

        {showBrowser && (
          <div className="browser-list" style={{ maxHeight: 160, marginBottom: 14, borderTop: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
            {browseParent && (
              <div className="browser-item" onClick={() => openBrowser(browseParent)}>
                <Icon name="chevron-right" size={12} style={{ transform: 'rotate(180deg)' }} />
                <span className="browser-name muted">..</span>
              </div>
            )}
            {browseItems.map((item) => (
              <div
                key={item.path}
                className={`browser-item${item.path === directory ? ' is-selected' : ''}`}
                onClick={() => openBrowser(item.path)}
              >
                <Icon name="folder" size={14} />
                <span className="browser-name">{item.name}</span>
              </div>
            ))}
            {!browsing && browseItems.length === 0 && (
              <div className="muted small" style={{ padding: 12 }}>No subdirectories</div>
            )}
          </div>
        )}

        <label className="lbl">File name</label>
        <div className="field-row" style={{ marginBottom: 14 }}>
          <input
            className="field-input mono"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="mydata.db"
            spellCheck={false}
            onKeyDown={(e) => { if (e.key === 'Enter' && canCreate) handleCreate(); }}
          />
        </div>

        {isEncrypted && (
          <>
            <label className="lbl">Encryption</label>
            <div className="btn-row" style={{ marginBottom: 10 }}>
              <button className={cx('btn btn-xs', !hexMode && 'btn-primary')} onClick={() => { setHexMode(false); setPass(''); setConfirm(''); setError(null); }}>
                Passphrase
              </button>
              <button className={cx('btn btn-xs', hexMode && 'btn-primary')} onClick={() => { setHexMode(true); setPass(''); setConfirm(''); setError(null); }}>
                Hex key
              </button>
            </div>

            <label className="lbl">{hexMode ? 'Raw hex key (256-bit)' : 'Passphrase'}</label>
            <div className="field-row" style={{ marginBottom: 10 }}>
              <input
                className="field-input mono"
                type={showPass ? 'text' : 'password'}
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder={hexMode ? '64 hex characters' : '••••••••••••••••'}
                spellCheck={false}
              />
              <button className="iconbtn" onClick={() => setShowPass(v => !v)} title={showPass ? 'Hide' : 'Show'}>
                <Icon name={showPass ? 'eye-off' : 'eye'} size={14} />
              </button>
            </div>

            <label className="lbl">{hexMode ? 'Confirm hex key' : 'Confirm passphrase'}</label>
            <div className="field-row" style={{ marginBottom: 14 }}>
              <input
                className="field-input mono"
                type={showPass ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={hexMode ? '64 hex characters' : '••••••••••••••••'}
                spellCheck={false}
                onKeyDown={(e) => { if (e.key === 'Enter' && canCreate) handleCreate(); }}
              />
            </div>

            {hexMode && (
              <div className="muted small" style={{ marginBottom: 8 }}>
                Format: 64 hex characters representing a 256-bit key
              </div>
            )}
          </>
        )}

        {error && <div style={{ color: 'var(--err)', fontSize: '0.923em', marginBottom: 8 }}>{error}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={!canCreate || loading}>
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

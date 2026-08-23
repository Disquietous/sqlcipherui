import { useState } from 'react';
import { Icon } from '../icons/Icon';
import { unlockDatabase } from '../../api/database';
import { useConnectionStore } from '../../stores/connection';

const cx = (...xs) => xs.filter(Boolean).join(' ');

function formatKeyForApi(value, hexMode) {
  if (hexMode) {
    const hex = value.replace(/\s/g, '').toLowerCase();
    return `x'${hex}'`;
  }
  return value;
}

export function UnlockModal({ connId, onClose }) {
  const [pass, setPass] = useState('');
  const [hexMode, setHexMode] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const connections = useConnectionStore((s) => s.connections);
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const dbInfo = connections[connId] || null;

  const handleUnlock = async () => {
    if (!pass) return;
    if (hexMode) {
      const hex = pass.replace(/\s/g, '');
      if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
        setError('Hex key must be exactly 64 hex characters (256-bit key)');
        return;
      }
    }
    setError(null);
    setLoading(true);
    try {
      await unlockDatabase(connId, formatKeyForApi(pass, hexMode));
      updateConnection(connId, { unlocked: true });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-bg">
      <div className="modal">
        <div className="modal-ic"><Icon name="lock" size={22} /></div>
        <h3 className="modal-title">Unlock encrypted database</h3>
        <div className="muted small modal-sub mono">{dbInfo?.path}</div>
        <div className="btn-row" style={{ marginBottom: 8 }}>
          <button className={cx('btn btn-xs', !hexMode && 'btn-primary')} onClick={() => { setHexMode(false); setPass(''); setError(null); }}>Passphrase</button>
          <button className={cx('btn btn-xs', hexMode && 'btn-primary')} onClick={() => { setHexMode(true); setPass(''); setError(null); }}>Hex key</button>
        </div>
        <label className="lbl">{hexMode ? 'Raw hex key (256-bit)' : 'Passphrase'}</label>
        <div style={{ position: 'relative' }}>
          <input
            className="field-input mono"
            type={showPass ? 'text' : 'password'}
            autoFocus
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleUnlock(); }}
            placeholder={hexMode ? '64 hex characters' : '••••••••••••••••'}
            style={{ paddingRight: 36 }}
            spellCheck={false}
          />
          <button
            type="button"
            className="iconbtn"
            onClick={() => setShowPass(v => !v)}
            title={showPass ? 'Hide' : 'Show'}
            style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
          >
            <Icon name={showPass ? 'eye-off' : 'eye'} size={14} />
          </button>
        </div>
        {hexMode && (
          <div className="muted small" style={{ marginTop: 4 }}>
            Format: 64 hex characters representing a 256-bit key
          </div>
        )}
        {error && <div style={{ color: 'var(--err)', fontSize: '0.923em', marginTop: 4 }}>{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleUnlock} disabled={loading}>
            {loading ? 'Unlocking...' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  );
}

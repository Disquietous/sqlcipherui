import { useState, useEffect } from 'react';
import { Icon } from '../icons/Icon';
import { useConnectionStore } from '../../stores/connection';
import { executeQuery } from '../../api/query';
import { rekeyDatabase, verifyPassphrase, encryptDatabase, decryptDatabase } from '../../api/cipher';

const cx = (...xs) => xs.filter(Boolean).join(' ');

function generateHexKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function KeyInput({ value, onChange, placeholder, hexMode, allowGenerate }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field field-row">
      <Icon name="key" size={13} />
      <input
        className="field-input mono"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || (hexMode ? "64 hex characters" : "••••••••••••••••")}
        spellCheck={false}
      />
      {hexMode && allowGenerate && (
        <button className="field-act" onClick={() => onChange(generateHexKey())} title="Generate random 256-bit key">
          <Icon name="refresh" size={12} />
        </button>
      )}
      <button className="field-act" onClick={() => setShow(!show)} title={show ? 'Hide' : 'Show'}>
        <Icon name="view" size={12} />
      </button>
    </div>
  );
}

function KeyModeToggle({ hexMode, onChange }) {
  return (
    <div className="btn-row" style={{ marginBottom: 8 }}>
      <button className={cx('btn btn-xs', !hexMode && 'btn-primary')} onClick={() => onChange(false)}>Passphrase</button>
      <button className={cx('btn btn-xs', hexMode && 'btn-primary')} onClick={() => onChange(true)}>Hex key</button>
    </div>
  );
}

function formatKeyForApi(value, hexMode) {
  if (hexMode) {
    const hex = value.replace(/\s/g, '').toLowerCase();
    return `x'${hex}'`;
  }
  return value;
}

function validateKey(value, hexMode) {
  if (!value) return 'Required';
  if (hexMode) {
    const hex = value.replace(/\s/g, '');
    if (hex.length !== 64) return `Need 64 hex chars (have ${hex.length})`;
    if (!/^[0-9a-fA-F]+$/.test(hex)) return 'Invalid hex characters';
    return null;
  }
  if (value.length < 1) return 'Required';
  return null;
}

function StrengthBar({ value, hexMode }) {
  if (hexMode) return null;
  const strength = Math.min(4, Math.floor(value.length / 4));
  return (
    <div className="strength">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className={cx('strength-bar', i < strength && `is-on s-${strength}`)} />
      ))}
      <span className="muted small">
        {['—', 'weak', 'fair', 'good', 'strong'][strength] || '—'}
      </span>
    </div>
  );
}

function Feedback({ feedback }) {
  if (!feedback) return null;
  return (
    <div style={{
      padding: '6px 10px', marginTop: 8, borderRadius: 6, fontSize: '0.923em',
      background: feedback.ok ? 'var(--ok-soft, rgba(40,200,64,0.1))' : 'var(--err-soft, rgba(255,80,80,0.1))',
      color: feedback.ok ? 'var(--ok)' : 'var(--err)',
    }}>
      {feedback.msg}
    </div>
  );
}

function ConfirmDialog({ title, description, consequences, onConfirm, onCancel, confirmLabel, busy }) {
  return (
    <div className="cipher-confirm-overlay" onClick={onCancel}>
      <div className="cipher-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="cipher-confirm-title">
          <Icon name="alert" size={16} />
          {title}
        </div>
        <p className="cipher-confirm-desc">{description}</p>
        {consequences && (
          <ul className="cipher-confirm-list">
            {consequences.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        )}
        <div className="btn-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CipherPanel() {
  const connections = useConnectionStore((s) => s.connections);
  const activeDbId = useConnectionStore((s) => s.activeDbId);
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const dbInfo = connections[activeDbId] || null;
  const [kdf, setKdf] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const [verifyKey, setVerifyKey] = useState('');
  const [verifyHex, setVerifyHex] = useState(false);

  const [rekeyKey, setRekeyKey] = useState('');
  const [rekeyHex, setRekeyHex] = useState(false);

  const [encryptKey, setEncryptKey] = useState('');
  const [encryptHex, setEncryptHex] = useState(false);

  const [decryptKey, setDecryptKey] = useState('');
  const [decryptHex, setDecryptHex] = useState(false);

  const isEncrypted = dbInfo?.encrypted;

  useEffect(() => {
    if (!isEncrypted) { setKdf(null); return; }
    let cancelled = false;
    async function loadKdf() {
      const params = {};
      const pragmas = ['cipher_version', 'kdf_iter', 'cipher_page_size', 'cipher_hmac_algorithm', 'cipher_kdf_algorithm'];
      for (const p of pragmas) {
        try {
          const r = await executeQuery(`PRAGMA ${p}`, activeDbId);
          if (r.rows?.length) params[p] = String(r.rows[0][0]);
        } catch { /* may not be available */ }
      }
      if (!cancelled) setKdf(params);
    }
    loadKdf();
    return () => { cancelled = true; };
  }, [isEncrypted, activeDbId]);

  const handleVerify = async () => {
    const err = validateKey(verifyKey, verifyHex);
    if (err) { setFeedback({ ok: false, msg: err }); return; }
    setBusy(true);
    setFeedback(null);
    try {
      const res = await verifyPassphrase(formatKeyForApi(verifyKey, verifyHex), activeDbId);
      setFeedback({ ok: res.ok, msg: res.ok ? 'Passphrase verified successfully' : 'Incorrect passphrase' });
    } catch (e) {
      setFeedback({ ok: false, msg: e.message });
    }
    setBusy(false);
  };

  const handleRekey = () => {
    const err = validateKey(rekeyKey, rekeyHex);
    if (err) { setFeedback({ ok: false, msg: err }); return; }
    setConfirm({
      title: 'Change encryption key',
      description: 'This will re-encrypt every page of the database with the new key. The current key will no longer work.',
      consequences: [
        'All data pages will be re-encrypted in place',
        'The old passphrase / key will stop working immediately',
        'Anyone with a copy of the file will need the new key',
        'This operation cannot be undone — keep the new key safe',
      ],
      confirmLabel: 'Rekey database',
      action: async () => {
        setBusy(true);
        setFeedback(null);
        try {
          await rekeyDatabase(formatKeyForApi(rekeyKey, rekeyHex), activeDbId);
          setFeedback({ ok: true, msg: 'Database rekeyed successfully — the new key is now active' });
          setRekeyKey('');
        } catch (e) {
          setFeedback({ ok: false, msg: e.message });
        }
        setBusy(false);
      },
    });
  };

  const handleEncrypt = () => {
    const err = validateKey(encryptKey, encryptHex);
    if (err) { setFeedback({ ok: false, msg: err }); return; }
    setConfirm({
      title: 'Encrypt database',
      description: 'This will convert the plain SQLite database to an encrypted SQLCipher database.',
      consequences: [
        'A new encrypted copy is created and replaces the original file',
        'All data is preserved — the schema and contents are unchanged',
        'You will need the passphrase / key to open this database in the future',
        'The database file will grow slightly due to encryption overhead',
        'Applications that use plain SQLite will no longer be able to read this file',
      ],
      confirmLabel: 'Encrypt database',
      action: async () => {
        setBusy(true);
        setFeedback(null);
        try {
          await encryptDatabase(formatKeyForApi(encryptKey, encryptHex), activeDbId);
          updateConnection(activeDbId, { encrypted: true, unlocked: true });
          setFeedback({ ok: true, msg: 'Database encrypted successfully — keep your key safe' });
          setEncryptKey('');
        } catch (e) {
          setFeedback({ ok: false, msg: e.message });
        }
        setBusy(false);
      },
    });
  };

  const handleDecrypt = () => {
    const err = validateKey(decryptKey, decryptHex);
    if (err) { setFeedback({ ok: false, msg: err }); return; }
    setConfirm({
      title: 'Remove encryption',
      description: 'This will convert the encrypted SQLCipher database back to a plain SQLite database.',
      consequences: [
        'A new plaintext copy is created and replaces the encrypted file',
        'All data is preserved — the schema and contents are unchanged',
        'The database will be readable by any SQLite tool without a passphrase',
        'Anyone with access to the file will be able to read all data',
        'This operation cannot be undone from the file alone',
      ],
      confirmLabel: 'Remove encryption',
      action: async () => {
        setBusy(true);
        setFeedback(null);
        try {
          await decryptDatabase(formatKeyForApi(decryptKey, decryptHex), activeDbId);
          updateConnection(activeDbId, { encrypted: false, unlocked: true });
          setFeedback({ ok: true, msg: 'Database decrypted — it is now a plain SQLite file' });
          setDecryptKey('');
        } catch (e) {
          setFeedback({ ok: false, msg: e.message });
        }
        setBusy(false);
      },
    });
  };

  const doConfirm = async () => {
    if (confirm?.action) await confirm.action();
    setConfirm(null);
  };

  return (
    <div className="panel cipher-panel">
      <div className="cipher-hero">
        <div className="cipher-hero-ic"><Icon name="shield" size={28} /></div>
        <div>
          <div className="muted small">Encryption status</div>
          <h2 className="cipher-hero-title">
            {isEncrypted ? 'Database is encrypted' : 'Database is not encrypted'}
          </h2>
          <div className="muted small">
            {isEncrypted
              ? `Encrypted with SQLCipher${kdf?.cipher_version ? ' ' + kdf.cipher_version : ''}`
              : 'This is a plain SQLite database — you can encrypt it below'}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <span className={cx('pill pill-lg', isEncrypted ? 'pill-ok' : 'pill-soft')}>
          <Icon name={isEncrypted ? 'lock' : 'unlock'} size={12} />
          {isEncrypted ? ' encrypted' : ' plain'}
        </span>
      </div>

      <Feedback feedback={feedback} />

      <div className="cipher-grid">
        {isEncrypted ? (
          <>
            <div className="card">
              <div className="card-h"><div className="card-title">Verify passphrase</div></div>
              <div className="card-body">
                <p className="muted small" style={{ margin: '0 0 8px' }}>
                  Test whether a passphrase or key matches this database without changing anything.
                </p>
                <KeyModeToggle hexMode={verifyHex} onChange={setVerifyHex} />
                <KeyInput value={verifyKey} onChange={setVerifyKey} hexMode={verifyHex} />
                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button className="btn btn-primary" disabled={busy || !verifyKey} onClick={handleVerify}>
                    Verify
                  </button>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-h"><div className="card-title">Change encryption key</div></div>
              <div className="card-body">
                <p className="muted small" style={{ margin: '0 0 8px' }}>
                  Re-encrypt the database with a new passphrase or hex key. The old key will stop working.
                </p>
                <label className="lbl">New key</label>
                <KeyModeToggle hexMode={rekeyHex} onChange={setRekeyHex} />
                <KeyInput value={rekeyKey} onChange={setRekeyKey} hexMode={rekeyHex} placeholder={rekeyHex ? "64 hex characters" : "New passphrase"} allowGenerate />
                <StrengthBar value={rekeyKey} hexMode={rekeyHex} />
                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button className="btn btn-danger" disabled={busy || !rekeyKey} onClick={handleRekey}>
                    Rekey database
                  </button>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-h"><div className="card-title">Remove encryption</div></div>
              <div className="card-body">
                <p className="muted small" style={{ margin: '0 0 8px' }}>
                  Convert this database back to plain SQLite. Provide the current passphrase to confirm.
                </p>
                <KeyModeToggle hexMode={decryptHex} onChange={setDecryptHex} />
                <KeyInput value={decryptKey} onChange={setDecryptKey} hexMode={decryptHex} placeholder={decryptHex ? "Current hex key" : "Current passphrase"} />
                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button className="btn btn-danger" disabled={busy || !decryptKey} onClick={handleDecrypt}>
                    Remove encryption
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="card">
            <div className="card-h"><div className="card-title">Encrypt this database</div></div>
            <div className="card-body">
              <p className="muted small" style={{ margin: '0 0 8px' }}>
                Convert this plain SQLite database to an encrypted SQLCipher database. All data will be preserved.
              </p>
              <KeyModeToggle hexMode={encryptHex} onChange={setEncryptHex} />
              <KeyInput value={encryptKey} onChange={setEncryptKey} hexMode={encryptHex} allowGenerate />
              <StrengthBar value={encryptKey} hexMode={encryptHex} />
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="btn btn-primary" disabled={busy || !encryptKey} onClick={handleEncrypt}>
                  Encrypt database
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-h"><div className="card-title">{isEncrypted ? 'KDF parameters' : 'Database info'}</div></div>
          <div className="card-body">
            {isEncrypted && kdf ? (
              <>
                <div className="row-kv"><span>Algorithm</span><b className="mono">{kdf.cipher_kdf_algorithm || 'PBKDF2_HMAC_SHA512'}</b></div>
                <div className="row-kv"><span>Iterations</span><b className="mono">{kdf.kdf_iter ? Number(kdf.kdf_iter).toLocaleString() : '—'}</b></div>
                <div className="row-kv"><span>HMAC</span><b className="mono">{kdf.cipher_hmac_algorithm || '—'}</b></div>
                <div className="row-kv"><span>Page size</span><b className="mono">{kdf.cipher_page_size ? `${Number(kdf.cipher_page_size).toLocaleString()} B` : '—'}</b></div>
                <div className="row-kv"><span>Cipher version</span><b className="mono">{kdf.cipher_version || '—'}</b></div>
              </>
            ) : (
              <>
                <div className="row-kv"><span>Engine</span><b className="mono">{isEncrypted ? 'SQLCipher' : 'SQLite'}</b></div>
                <div className="row-kv"><span>Page size</span><b className="mono">{dbInfo?.page_size ? `${dbInfo.page_size} B` : '—'}</b></div>
                <div className="row-kv"><span>Journal mode</span><b className="mono">{dbInfo?.journal_mode?.toUpperCase() || '—'}</b></div>
                <div className="row-kv"><span>File</span><b className="mono" style={{ fontSize: '0.917em' }}>{dbInfo?.path || '—'}</b></div>
              </>
            )}
          </div>
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          description={confirm.description}
          consequences={confirm.consequences}
          confirmLabel={confirm.confirmLabel}
          onConfirm={doConfirm}
          onCancel={() => setConfirm(null)}
          busy={busy}
        />
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Icon } from '../icons/Icon';
import { executeQuery } from '../../api/query';
import { runVacuum, runIntegrityCheck, runAnalyze } from '../../api/maintenance';
import { useConnectionStore } from '../../stores/connection';
import { getDatabaseInfo } from '../../api/database';

const cx = (...xs) => xs.filter(Boolean).join(' ');

const PRAGMA_KEYS = [
  'journal_mode', 'synchronous', 'cache_size', 'page_size', 'auto_vacuum',
  'foreign_keys', 'wal_autocheckpoint', 'busy_timeout', 'mmap_size',
  'temp_store', 'encoding', 'compile_options',
];

const EDITABLE = new Set([
  'journal_mode', 'synchronous', 'cache_size', 'auto_vacuum',
  'foreign_keys', 'wal_autocheckpoint', 'busy_timeout', 'mmap_size',
  'temp_store',
]);

export function SettingsPanel() {
  const connections = useConnectionStore((s) => s.connections);
  const activeDbId = useConnectionStore((s) => s.activeDbId);
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const [pragmas, setPragmas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(null);
  const [result, setResult] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!activeDbId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const results = [];
      for (const key of PRAGMA_KEYS) {
        try {
          const r = await executeQuery(`PRAGMA ${key}`, activeDbId);
          const val = r.rows?.length ? String(r.rows[0][0]) : '—';
          results.push({ key, value: val, edited: val, editable: EDITABLE.has(key) });
        } catch {
          results.push({ key, value: 'error', edited: 'error', editable: false });
        }
      }
      if (!cancelled) {
        setPragmas(results);
        setLoading(false);
        setDirty(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [activeDbId]);

  const handleEdit = (key, newVal) => {
    setPragmas(prev => prev.map(p =>
      p.key === key ? { ...p, edited: newVal } : p
    ));
    setDirty(true);
  };

  const handleApply = async () => {
    const changed = pragmas.filter(p => p.editable && p.edited !== p.value);
    if (changed.length === 0) return;
    setResult(null);
    const errors = [];
    for (const p of changed) {
      try {
        await executeQuery(`PRAGMA ${p.key} = ${p.edited}`, activeDbId);
      } catch (e) {
        errors.push(`${p.key}: ${e.message}`);
      }
    }
    if (errors.length > 0) {
      setResult({ msg: errors.join('; '), ok: false, label: 'Apply' });
    } else {
      setResult({ msg: `Applied ${changed.length} change(s)`, ok: true, label: 'Apply' });
    }
    const results = [];
    for (const key of PRAGMA_KEYS) {
      try {
        const r = await executeQuery(`PRAGMA ${key}`, activeDbId);
        const val = r.rows?.length ? String(r.rows[0][0]) : '—';
        results.push({ key, value: val, edited: val, editable: EDITABLE.has(key) });
      } catch {
        results.push({ key, value: 'error', edited: 'error', editable: false });
      }
    }
    setPragmas(results);
    setDirty(false);
    const info = await getDatabaseInfo(activeDbId);
    updateConnection(activeDbId, info);
  };

  const handleReset = () => {
    setPragmas(prev => prev.map(p => ({ ...p, edited: p.value })));
    setDirty(false);
  };

  const handleMaintenance = async (label, fn) => {
    setRunning(label);
    setResult(null);
    try {
      const r = await fn(activeDbId);
      const msg = r.result ? `Result: ${r.result}` : `Done`;
      setResult({ label, msg, ok: r.ok !== false });
      const info = await getDatabaseInfo(activeDbId);
      updateConnection(activeDbId, info);
    } catch (e) {
      setResult({ label, msg: e.message, ok: false });
    }
    setRunning(null);
  };

  return (
    <div className="panel">
      <div className="toolbar">
        <span className="muted small">PRAGMA settings · changes take effect on next connection</span>
        <div style={{ flex: 1 }} />
        <button className="tb-btn" onClick={handleReset} disabled={!dirty}>
          <Icon name="refresh" size={12} /><span>Reset</span>
        </button>
        <button className="tb-btn tb-primary" onClick={handleApply} disabled={!dirty}>
          <Icon name="check" size={12} /><span>Apply</span>
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 24, color: 'var(--text-3)' }}>Loading pragmas...</div>
      ) : (
        <div className="grid-wrap">
          <div className="grid" style={{ gridTemplateColumns: '40% 1fr 80px' }}>
            <div className="gh">key</div>
            <div className="gh">value</div>
            <div className="gh"></div>
            {pragmas.map(p => (
              <PragmaRow key={p.key} p={p} onEdit={handleEdit} />
            ))}
          </div>
        </div>
      )}

      <div className="settings-actions">
        <div className="card">
          <div className="card-h"><div className="card-title">Maintenance</div></div>
          <div className="card-body">
            {result && (
              <div style={{
                padding: '8px 12px', marginBottom: 12, borderRadius: 6, fontSize: '0.923em',
                background: result.ok ? 'var(--ok-soft, rgba(40,200,64,0.1))' : 'var(--err-soft, rgba(255,80,80,0.1))',
                color: result.ok ? 'var(--ok)' : 'var(--err)',
              }}>
                {result.label}: {result.msg}
              </div>
            )}
            <div className="maint-row">
              <div>
                <b>VACUUM</b>
                <div className="muted small">Rebuild the database to reclaim free pages.</div>
              </div>
              <button className="btn" onClick={() => handleMaintenance('VACUUM', runVacuum)} disabled={!!running}>
                {running === 'VACUUM' ? 'Running…' : 'Run VACUUM'}
              </button>
            </div>
            <div className="maint-row">
              <div>
                <b>Integrity check</b>
                <div className="muted small">Verifies on-disk structure.</div>
              </div>
              <button className="btn" onClick={() => handleMaintenance('Integrity', runIntegrityCheck)} disabled={!!running}>
                {running === 'Integrity' ? 'Running…' : 'Run check'}
              </button>
            </div>
            <div className="maint-row">
              <div>
                <b>ANALYZE</b>
                <div className="muted small">Refresh statistics used by the query planner.</div>
              </div>
              <button className="btn" onClick={() => handleMaintenance('ANALYZE', runAnalyze)} disabled={!!running}>
                {running === 'ANALYZE' ? 'Running…' : 'Run ANALYZE'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PragmaRow({ p, onEdit }) {
  return (
    <>
      <div className="gc"><span className="cell-text mono">{p.key}</span></div>
      <div className="gc">
        {p.editable
          ? <input
              className="cell-input mono"
              value={p.edited}
              onChange={(e) => onEdit(p.key, e.target.value)}
            />
          : <span className="mono muted">{p.value}</span>}
      </div>
      <div className="gc gc-center">
        {p.editable
          ? <span className="pill pill-soft small">editable</span>
          : <span className="pill small">readonly</span>}
      </div>
    </>
  );
}

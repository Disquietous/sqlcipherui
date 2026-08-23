import { useState, useEffect } from 'react';
import { Icon } from '../icons/Icon';
import { useConnectionStore } from '../../stores/connection';
import { useHistoryStore } from '../../stores/history';
import { getTables } from '../../api/schema';

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function Sparkline({ data, w = 520, h = 56, stroke = 'var(--accent)', fill = 'var(--accent-soft)' }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => [i * step, h - (v / max) * (h - 4) - 2]);
  const line = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <path d={area} fill={fill} opacity={0.6} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

export function DashboardPanel() {
  const connections = useConnectionStore((s) => s.connections);
  const activeDbId = useConnectionStore((s) => s.activeDbId);
  const dbInfo = connections[activeDbId] || null;
  const historyEntries = useHistoryStore((s) => s.entries);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeDbId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const t = await getTables(activeDbId);
        if (!cancelled) setTables(t);
      } catch (e) { /* ignore */ }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [activeDbId]);

  const totalRows = tables.reduce((sum, t) => sum + (t.row_count || 0), 0);
  const topTables = [...tables].sort((a, b) => (b.row_count || 0) - (a.row_count || 0)).slice(0, 5);
  const maxRows = topTables.length ? topTables[0].row_count || 1 : 1;

  const recentHistory = historyEntries.slice(0, 5);
  const sparkData = (() => {
    const buckets = new Array(30).fill(0);
    const now = Date.now();
    for (const h of historyEntries) {
      const age = (now - (h._ts || now)) / 60000;
      const bucket = Math.min(29, Math.floor(age));
      if (bucket >= 0 && bucket < 30) buckets[29 - bucket]++;
    }
    return buckets;
  })();
  const avgQpm = historyEntries.length > 0
    ? (historyEntries.length / Math.max(1, 30)).toFixed(1)
    : '0';

  if (loading) {
    return (
      <div className="dash" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>
        Loading...
      </div>
    );
  }

  return (
    <div className="dash">
      <div className="dash-header">
        <div>
          <div className="muted small">Database</div>
          <h2 className="dash-title">{dbInfo?.name || 'Unknown'}</h2>
          <div className="muted small mono">{dbInfo?.path}</div>
        </div>
        <div className="dash-pills">
          <div className="kpi">
            <div className="kpi-label">Size</div>
            <div className="kpi-value">{dbInfo?.size_display || formatBytes(dbInfo?.size_bytes)}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Tables</div>
            <div className="kpi-value">{tables.length}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Rows</div>
            <div className="kpi-value">{totalRows.toLocaleString()}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Journal</div>
            <div className="kpi-value">{dbInfo?.journal_mode?.toUpperCase() || '—'}</div>
          </div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="card card-span-2">
          <div className="card-h">
            <div>
              <div className="card-title">Query activity</div>
              <div className="card-sub muted small">Queries / min · this session</div>
            </div>
            <span className="pill pill-soft">live</span>
          </div>
          <div className="card-body card-body-pad">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
              <div className="stat-big">{avgQpm}</div>
              <div className="muted small" style={{ paddingBottom: 4 }}>{historyEntries.length} queries this session</div>
            </div>
            <Sparkline data={sparkData} />
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <div className="card-title">Encryption</div>
            <span className="pill pill-ok">
              <Icon name={dbInfo?.encrypted ? 'lock' : 'unlock'} size={10} />
              {dbInfo?.encrypted ? ' encrypted' : ' plain'}
            </span>
          </div>
          <div className="card-body">
            <div className="row-kv"><span>Engine</span><b>{dbInfo?.encrypted ? 'SQLCipher' : 'SQLite'}</b></div>
            <div className="row-kv"><span>Page size</span><b>{dbInfo?.page_size ? `${dbInfo.page_size} B` : '—'}</b></div>
            <div className="row-kv"><span>Pages</span><b>{dbInfo?.page_count?.toLocaleString() || '—'}</b></div>
            <div className="row-kv"><span>Free pages</span><b>{dbInfo?.freelist_count?.toLocaleString() || '0'}</b></div>
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <div className="card-title">Top tables</div>
            <span className="muted small">by rows</span>
          </div>
          <div className="card-body">
            {topTables.length === 0 && (
              <div className="muted small" style={{ padding: 8 }}>No tables found</div>
            )}
            {topTables.map(t => (
              <div key={t.name} className="bar-row">
                <span className="bar-name mono">{t.name}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${((t.row_count || 0) / maxRows) * 100}%` }} />
                </div>
                <span className="bar-val mono">{(t.row_count || 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <div className="card-title">Health</div>
            <span className="pill pill-ok">good</span>
          </div>
          <div className="card-body">
            <div className="row-kv"><span>Journal mode</span><b>{dbInfo?.journal_mode?.toUpperCase() || '—'}</b></div>
            <div className="row-kv"><span>Tables</span><b>{tables.length}</b></div>
            <div className="row-kv"><span>Total rows</span><b>{totalRows.toLocaleString()}</b></div>
            <div className="row-kv"><span>Free pages</span><b>{dbInfo?.freelist_count || 0}</b></div>
          </div>
        </div>

        <div className="card card-span-2">
          <div className="card-h">
            <div className="card-title">Recent activity</div>
            <span className="muted small">this session</span>
          </div>
          <div className="card-body card-body-flush">
            <div className="actlist">
              {recentHistory.length === 0 && (
                <div className="muted small" style={{ padding: '12px 16px' }}>No queries executed yet.</div>
              )}
              {recentHistory.map((h, i) => (
                <div key={i} className="act-row">
                  <Icon name={h.error ? 'close' : 'terminal'} size={13} />
                  <span className="act-t mono">{h.sql?.length > 60 ? h.sql.slice(0, 60) + '…' : h.sql}</span>
                  <span className="act-m muted small">{h.elapsed_ms} ms · {h.row_count} rows</span>
                  <span className="act-a muted small mono">{h.ts}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

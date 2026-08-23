import { useEffect } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { getRuns } from '../../api/dataflow';

const cx = (...xs) => xs.filter(Boolean).join(' ');

function fmtDuration(ms) {
  if (ms == null) return '--';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function DFDockHistory() {
  const runs = useDataFlowStore((s) => s.runs);
  const pipeline = useDataFlowStore((s) => s.pipeline);
  const isRunning = useDataFlowStore((s) => s.isRunning);
  const setRuns = useDataFlowStore((s) => s.setRuns);

  useEffect(() => {
    if (!pipeline?.id) return;
    getRuns(pipeline.id).then(setRuns).catch(() => {});
  }, [pipeline?.id, isRunning]);

  if (runs.length === 0) {
    return (
      <div className="df-history-list" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: '0.923em', padding: 24 }}>
        No runs yet.
      </div>
    );
  }

  return (
    <div className="df-history-list">
      <div className="df-history-h">
        <div>When</div><div>Mode</div><div>Status</div><div>Duration</div><div>Rows</div><div></div>
      </div>
      {runs.map(r => (
        <div key={r.id} className={cx('df-history-row', r.status === 'failed' && 'is-err')}>
          <div className="mono small">{r.created_at || r.when}</div>
          <div><span className="pill small">{r.mode}</span></div>
          <div>
            <span className={cx('pill small',
              r.status === 'ok' ? 'pill-ok' :
              r.status === 'failed' ? 'pill-err' :
              r.status === 'running' ? 'pill-soft' :
              'pill-soft')}>
              <Icon name={r.status === 'ok' ? 'check' : r.status === 'failed' ? 'close' : 'alert'} size={9} />
              {r.status}
            </span>
          </div>
          <div className="mono small">{fmtDuration(r.duration_ms)}</div>
          <div className="mono small">{r.total_rows != null ? r.total_rows.toLocaleString() : '--'}</div>
          <div>
            {r.error && <span className="muted small" title={r.error}><Icon name="alert" size={10} /></span>}
          </div>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { getRuns, getRunEvents } from '../../api/dataflow';
import { fmtDuration, fmtRows } from './useRunController';
import { RunStatusPill } from './DFTopBar';
import { DFLogLines } from './DFDockLog';

const cx = (...xs) => xs.filter(Boolean).join(' ');

function fmtWhen(s) {
  if (!s) return '--';
  // Backend stores UTC "YYYY-MM-DD HH:MM:SS"; show it in local time when parseable.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function DFDockHistory() {
  const runs = useDataFlowStore((s) => s.runs);
  const pipeline = useDataFlowStore((s) => s.pipeline);
  const isRunning = useDataFlowStore((s) => s.isRunning);
  const setRuns = useDataFlowStore((s) => s.setRuns);
  const pushToast = useDataFlowStore((s) => s.pushToast);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [events, setEvents] = useState({}); // runId -> {loading, items, error}

  const pipelineId = pipeline?.id;

  // Reload the list when the pipeline opens and whenever a run finishes.
  useEffect(() => {
    if (!pipelineId || isRunning) return;
    let cancelled = false;
    getRuns(pipelineId)
      .then((r) => { if (!cancelled) setRuns(r); })
      .catch((err) => { if (!cancelled) pushToast({ level: 'error', message: `Could not load run history: ${err.message}` }); });
    return () => { cancelled = true; };
  }, [pipelineId, isRunning, setRuns, pushToast]);

  const refresh = () => {
    if (!pipelineId) return;
    setLoading(true);
    getRuns(pipelineId)
      .then(setRuns)
      .catch((err) => pushToast({ level: 'error', message: `Could not load run history: ${err.message}` }))
      .finally(() => setLoading(false));
  };

  const toggle = (runId) => {
    if (openId === runId) { setOpenId(null); return; }
    setOpenId(runId);
    if (events[runId]) return;
    setEvents(m => ({ ...m, [runId]: { loading: true, items: [] } }));
    getRunEvents(runId)
      .then((items) => setEvents(m => ({ ...m, [runId]: { loading: false, items: Array.isArray(items) ? items : items?.events || [] } })))
      .catch((err) => {
        setEvents(m => ({ ...m, [runId]: { loading: false, items: [], error: err.message } }));
        pushToast({ level: 'error', message: `Could not load run events: ${err.message}` });
      });
  };

  return (
    <div className="df-history-list">
      <div className="df-history-h">
        <div>When</div><div>Status</div><div>Mode</div><div>By</div><div>Duration</div><div>Rows</div>
        <div className="df-history-refresh">
          <button className="iconbtn-sm" onClick={refresh} disabled={loading} aria-label="Refresh run history" title="Refresh">
            <Icon name="refresh" size={11} />
          </button>
        </div>
      </div>
      {runs.length === 0 && (
        <div className="df-history-empty">{loading ? 'Loading…' : 'No runs yet.'}</div>
      )}
      {runs.map(r => {
        const open = openId === r.id;
        const ev = events[r.id];
        return (
          <div key={r.id} className={cx('df-history-item', open && 'is-open')}>
            <button
              className={cx('df-history-row', r.status === 'failed' && 'is-err', r.status === 'partial' && 'is-warn')}
              onClick={() => toggle(r.id)}
              aria-expanded={open}
              aria-label={`Run ${r.id}, ${r.status}`}
            >
              <div className="mono small df-history-when">
                <Icon name={open ? 'chevron-down' : 'chevron-right'} size={10} />
                {fmtWhen(r.started_at || r.created_at)}
              </div>
              <div><RunStatusPill status={r.status} isRunning={r.status === 'running'} /></div>
              <div><span className="pill small">{r.mode}</span></div>
              <div className="small muted">{r.initiated_by || 'user'}</div>
              <div className="mono small">{fmtDuration(r.duration_ms)}</div>
              <div className="mono small">{fmtRows(r.total_rows)}</div>
              <div className="df-history-err" title={r.error || ''}>
                {r.error && <><Icon name="alert" size={10} /><span>{r.error}</span></>}
              </div>
            </button>
            {open && (
              <div className="df-history-detail">
                <div className="df-history-meta">
                  <span>Run <b className="mono">#{r.id}</b></span>
                  <span>Started <b className="mono">{r.started_at || '--'}</b></span>
                  <span>Finished <b className="mono">{r.finished_at || '--'}</b></span>
                  <span>Initiated by <b>{r.initiated_by || 'user'}</b></span>
                </div>
                {r.error && <div className="df-history-error mono">{r.error}</div>}
                <div className="df-history-events">
                  {ev?.loading && <div className="df-history-empty">Loading events…</div>}
                  {ev && !ev.loading && ev.items.length === 0 && (
                    <div className="df-history-empty">{ev.error ? `Failed to load events: ${ev.error}` : 'No events recorded for this run.'}</div>
                  )}
                  {ev && ev.items.length > 0 && <DFLogLines events={ev.items} />}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

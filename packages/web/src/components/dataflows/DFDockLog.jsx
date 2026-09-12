import { useRef, useEffect } from 'react';
import { useDataFlowStore } from '../../stores/dataflow';
import { summarizeRun, statusLevel } from './useRunController';

const cx = (...xs) => xs.filter(Boolean).join(' ');

const LEVEL_CLASS = { info: 'info', warn: 'warn', warning: 'warn', error: 'err', err: 'err', ok: 'ok' };

function fmtTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts).slice(11, 23);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Normalise a live or stored event into {ts, level, node, message, isStatus}. */
function describe(ev) {
  const ts = fmtTs(ev.timestamp || ev.ts || ev.created_at);
  const type = ev.type || 'log';
  switch (type) {
    case 'status':
      return {
        ts, isStatus: true,
        level: ev.status === 'running' ? 'info' : statusLevel(ev.status),
        message: ev.status === 'running'
          ? `Run${ev.run_id != null ? ` #${ev.run_id}` : ''} started`
          : `Run${ev.run_id != null ? ` #${ev.run_id}` : ''} finished: ${ev.status}`,
      };
    case 'done':
      return { ts, isStatus: true, level: statusLevel(ev.result?.status), message: summarizeRun(ev.result) };
    case 'summary':
      return { ts, isStatus: true, level: ev.level || statusLevel(ev.status), message: ev.message };
    case 'error':
      return { ts, isStatus: true, level: 'error', message: ev.message || 'Error' };
    case 'progress':
      return {
        ts, level: 'info', node: ev.node_id,
        message: `${Number(ev.in_rows ?? 0).toLocaleString()} in → ${Number(ev.out_rows ?? 0).toLocaleString()} out`,
      };
    case 'edge_progress':
      return { ts, level: 'info', node: ev.from, message: `→ ${ev.to}: ${Number(ev.rows ?? 0).toLocaleString()} rows` };
    default:
      return { ts, level: ev.level || 'info', node: ev.node_id, message: ev.message || ev.txt || '' };
  }
}

/** Shared renderer for live run events and stored run history events. */
export function DFLogLines({ events }) {
  return events.map((ev, i) => {
    const d = describe(ev);
    const lvl = LEVEL_CLASS[d.level] || 'info';
    return (
      <div key={ev.id ?? i} className={cx('df-log-line', `lvl-${lvl}`, d.isStatus && 'is-status', d.isStatus && `status-${lvl}`)}>
        <span className="df-log-ts mono">{d.ts}</span>
        <span className={cx('df-log-lvl', `lvl-${lvl}`)}>{d.level === 'error' ? 'error' : d.level}</span>
        <span className="df-log-node mono" title={d.node || ''}>{d.node || ''}</span>
        <span className="df-log-txt mono" title={d.message}>{d.message}</span>
      </div>
    );
  });
}

export function DFDockLog() {
  const runEvents = useDataFlowStore((s) => s.runEvents);
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [runEvents.length]);

  if (runEvents.length === 0) {
    return (
      <div className="df-log df-log-empty">
        No run events yet. Click Run (⌘⏎) to execute the pipeline.
      </div>
    );
  }

  return (
    <div className="df-log" ref={scrollRef} role="log" aria-live="polite">
      <DFLogLines events={runEvents} />
    </div>
  );
}

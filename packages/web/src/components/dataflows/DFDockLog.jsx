import { useRef, useEffect } from 'react';
import { useDataFlowStore } from '../../stores/dataflow';

const cx = (...xs) => xs.filter(Boolean).join(' ');

function fmtTs(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 });
  } catch { return ts; }
}

export function DFDockLog() {
  const runEvents = useDataFlowStore((s) => s.runEvents);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [runEvents.length]);

  if (runEvents.length === 0) {
    return (
      <div className="df-log" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: '0.923em' }}>
        No run events yet. Click Run to execute the pipeline.
      </div>
    );
  }

  return (
    <div className="df-log" ref={scrollRef}>
      {runEvents.map((ev, i) => {
        const lvl = ev.level || ev.type || 'info';
        const msg = ev.message || ev.txt || '';
        const ts = fmtTs(ev.timestamp || ev.ts);
        const nodeLabel = ev.node_id ? `[${ev.node_id}] ` : '';
        return (
          <div key={i} className={cx('df-log-line', `lvl-${lvl}`)}>
            <span className="df-log-ts mono">{ts}</span>
            <span className={cx('df-log-lvl', `lvl-${lvl}`)}>{lvl}</span>
            <span className="df-log-txt mono">{nodeLabel}{msg}</span>
          </div>
        );
      })}
    </div>
  );
}

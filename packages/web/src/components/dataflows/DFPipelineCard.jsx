import { Icon } from '../icons/Icon';

const cx = (...xs) => xs.filter(Boolean).join(' ');

/** Backend timestamps are UTC "YYYY-MM-DD HH:MM:SS" without a zone marker. */
function parseUtc(s) {
  if (!s) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function relativeTime(s) {
  const d = parseUtc(s);
  if (!d) return '';
  const diff = Math.max(0, Date.now() - d.getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

const STATUS_PILL = {
  ok: ['pill-ok', 'check'],
  partial: ['pill-warn', 'alert'],
  failed: ['pill-err', 'close'],
  cancelled: ['pill-soft', 'stop'],
  running: ['pill-soft', 'loader'],
};

export function RunStatusPill({ status }) {
  const [cls, icon] = STATUS_PILL[status] || ['pill-soft', 'dot'];
  return (
    <span className={cx('pill small', cls)}>
      <Icon name={icon} size={9} />
      {status || 'unknown'}
    </span>
  );
}

export function DFPipelineCard({ pipeline: p, onClick, onDelete }) {
  const lastRun = p.last_run || null;
  const tags = Array.isArray(p.tags) ? p.tags : [];
  const nodeCount = p.node_count ?? p.definition?.nodes?.length ?? 0;

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <div className="df-card" role="button" tabIndex={0} onClick={onClick} onKeyDown={onKeyDown} aria-label={`Open pipeline ${p.name}`}>
      <div className="df-card-head">
        <div className="df-card-name">
          {p.starred ? <Icon name="star" size={11} style={{ color: 'var(--warn)' }} /> : null}
          <span>{p.name}</span>
        </div>
        <span className="df-card-actions">
          <button
            type="button"
            className="iconbtn-sm"
            title="Delete pipeline"
            aria-label={`Delete pipeline ${p.name}`}
            onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
            onKeyDown={(e) => e.stopPropagation()}
            style={{ color: 'var(--text-3)' }}
          >
            <Icon name="close" size={10} />
          </button>
        </span>
      </div>
      <div className="df-card-desc">{p.description || 'No description'}</div>
      <div className="df-card-meta muted small">
        <span><Icon name="dot" size={8} /> {nodeCount} node{nodeCount === 1 ? '' : 's'}</span>
        {p.schedule_enabled && p.schedule ? <span title={p.schedule}><Icon name="clock" size={9} /> scheduled</span> : null}
      </div>
      {tags.length > 0 && (
        <div className="df-card-tags">
          {tags.map(t => <span key={t} className="df-tag">{t}</span>)}
        </div>
      )}
      <div className="df-card-foot">
        {lastRun ? (
          <>
            <RunStatusPill status={lastRun.status} />
            {lastRun.duration_ms != null && <span className="muted small">{formatDuration(lastRun.duration_ms)}</span>}
            {lastRun.total_rows != null && (
              <span className="muted small mono">{Number(lastRun.total_rows).toLocaleString()} rows</span>
            )}
            <span style={{ flex: 1 }}></span>
            <span className="muted small" title={lastRun.started_at}>{relativeTime(lastRun.started_at)}</span>
          </>
        ) : (
          <span className="muted small">Never run</span>
        )}
      </div>
    </div>
  );
}

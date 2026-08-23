import { Icon } from '../icons/Icon';

const cx = (...xs) => xs.filter(Boolean).join(' ');

export function DFPipelineCard({ pipeline: p, onClick, onDelete }) {
  const lastRun = p.last_run || p.lastRun;
  const tags = Array.isArray(p.tags) ? p.tags : (() => { try { const t = JSON.parse(p.tags); return Array.isArray(t) ? t : []; } catch { return []; } })();

  const handleDelete = (e) => {
    e.stopPropagation();
    onDelete?.();
  };

  return (
    <button className="df-card" onClick={onClick}>
      <div className="df-card-head">
        <div className="df-card-name">
          {p.starred ? <Icon name="star" size={11} style={{ color: 'var(--warn)' }} /> : null}
          <span>{p.name}</span>
        </div>
        <span className="df-card-actions" onClick={e => e.stopPropagation()}>
          <button className="iconbtn-sm" title="Delete pipeline" onClick={handleDelete} style={{ color: 'var(--text-3)' }}>
            <Icon name="close" size={10} />
          </button>
        </span>
      </div>
      <div className="df-card-desc">{p.description || p.desc || 'No description'}</div>
      {tags.length > 0 && (
        <div className="df-card-tags">
          {tags.map(t => <span key={t} className="df-tag">{t}</span>)}
        </div>
      )}
      {lastRun && (
        <div className="df-card-foot">
          <span className={cx('pill small',
            lastRun.status === 'ok' ? 'pill-ok' :
            lastRun.status === 'failed' ? 'pill-err' : 'pill-soft'
          )}>
            <Icon name={lastRun.status === 'ok' ? 'check' : lastRun.status === 'failed' ? 'close' : 'alert'} size={9} />
            {lastRun.status}
          </span>
          <span className="muted small">{lastRun.duration}</span>
          {lastRun.rows != null && (
            <span className="muted small mono">{lastRun.rows.toLocaleString()} rows</span>
          )}
          <span style={{ flex: 1 }}></span>
          <span className="muted small">{lastRun.at}</span>
        </div>
      )}
    </button>
  );
}

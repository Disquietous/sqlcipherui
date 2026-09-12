import { useState } from 'react';
import { Icon } from '../icons/Icon';
import { DF_NODE_CATALOG } from './catalog';

const cx = (...xs) => xs.filter(Boolean).join(' ');

const initialOpen = () => Object.fromEntries(DF_NODE_CATALOG.map(g => [g.group, true]));

function matches(n, q) {
  if (!q) return true;
  const hay = `${n.name} ${n.desc} ${n.kind}`.toLowerCase();
  return q.split(/\s+/).filter(Boolean).every(part => hay.includes(part));
}

export function DFNodeLibrary({ onToggle }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(initialOpen);
  const query = q.trim().toLowerCase();

  const dragStart = (e, kind) => {
    e.dataTransfer.setData('text/plain', kind);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const groups = DF_NODE_CATALOG
    .map(g => ({ ...g, items: g.nodes.filter(n => matches(n, query)) }))
    .filter(g => g.items.length > 0);

  return (
    <div className="df-lib">
      <div className="df-lib-head">
        <span style={{ fontWeight: 600, fontSize: '0.923em' }}>Node library</span>
        <div style={{ flex: 1 }}></div>
        <button type="button" className="iconbtn-sm" onClick={onToggle} title="Hide library" aria-label="Hide node library"><Icon name="close" size={11} /></button>
      </div>
      <div className="df-lib-search">
        <Icon name="search" size={11} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search nodes…" aria-label="Search nodes" />
        {q && (
          <button type="button" className="iconbtn-sm" onClick={() => setQ('')} aria-label="Clear search" title="Clear"><Icon name="close" size={9} /></button>
        )}
      </div>
      <div className="df-lib-scroll">
        {groups.length === 0 && <div className="df-empty">No nodes match "{q}".</div>}
        {groups.map(g => {
          const isOpen = query ? true : open[g.group] !== false;
          return (
            <div key={g.group} className="df-lib-group">
              <button
                type="button"
                className="df-lib-group-h"
                onClick={() => setOpen({ ...open, [g.group]: !isOpen })}
                aria-expanded={isOpen}
              >
                <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={10} />
                <span>{g.group}</span>
                <span className="muted small" style={{ marginLeft: 'auto' }}>{g.items.length}</span>
              </button>
              {isOpen && (
                <div className="df-lib-items">
                  {g.items.map(n => (
                    <div
                      key={n.kind}
                      className={cx('df-lib-item', `family-${g.family}`, n.status === 'soon' && 'is-soon')}
                      draggable
                      onDragStart={(e) => dragStart(e, n.kind)}
                      title={n.status === 'soon' ? `${n.desc} (not available yet)` : n.desc}
                    >
                      <span className="df-lib-icon"><Icon name={n.icon} size={12} /></span>
                      <span className="df-lib-name">{n.name}</span>
                      {n.status === 'soon' && <span className="df-soon-badge">soon</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="df-lib-foot muted small">
        <Icon name="grip" size={10} /> Drag a node onto the canvas
      </div>
    </div>
  );
}

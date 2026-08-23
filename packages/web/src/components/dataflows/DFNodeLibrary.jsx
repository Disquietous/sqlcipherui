import { useState } from 'react';
import { Icon } from '../icons/Icon';
import { DF_NODE_CATALOG } from './catalog';

const cx = (...xs) => xs.filter(Boolean).join(' ');

export function DFNodeLibrary({ onToggle }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState({
    Sources: true, Transform: true, Cleaning: false,
    'Schema ops': false, Code: false, Encryption: true, Sinks: true,
  });

  const dragStart = (e, kind) => {
    e.dataTransfer.setData('text/plain', kind);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="df-lib">
      <div className="df-lib-head">
        <span style={{ fontWeight: 600, fontSize: '0.923em' }}>Node library</span>
        <div style={{ flex: 1 }}></div>
        <button className="iconbtn-sm" onClick={onToggle} title="Hide library"><Icon name="close" size={11} /></button>
      </div>
      <div className="df-lib-search">
        <Icon name="search" size={11} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search nodes…" />
      </div>
      <div className="df-lib-scroll">
        {DF_NODE_CATALOG.map(g => {
          const items = g.nodes.filter(n => !q || n.name.toLowerCase().includes(q.toLowerCase()));
          if (items.length === 0) return null;
          const isOpen = open[g.group];
          return (
            <div key={g.group} className="df-lib-group">
              <button className="df-lib-group-h" onClick={() => setOpen({ ...open, [g.group]: !isOpen })}>
                <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={10} />
                <span>{g.group}</span>
                <span className="muted small" style={{ marginLeft: 'auto' }}>{items.length}</span>
              </button>
              {isOpen && (
                <div className="df-lib-items">
                  {items.map(n => (
                    <div
                      key={n.kind}
                      className={cx('df-lib-item', `family-${g.family}`)}
                      draggable
                      onDragStart={(e) => dragStart(e, n.kind)}
                      title={n.desc}
                    >
                      <span className="df-lib-icon"><Icon name={n.icon} size={12} /></span>
                      <span className="df-lib-name">{n.name}</span>
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

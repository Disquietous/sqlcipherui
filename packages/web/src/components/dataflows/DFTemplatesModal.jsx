import { useState, useEffect } from 'react';
import { Icon } from '../icons/Icon';
import { getTemplates } from '../../api/dataflow';
import { DF_NODE_BY_KIND } from './catalog';

const cx = (...xs) => xs.filter(Boolean).join(' ');

export function DFTemplatesModal({ onClose, onPick }) {
  const [templates, setTemplates] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getTemplates();
        if (!cancelled) setTemplates(data);
      } catch { /* ignore */ }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 720, textAlign: 'left', padding: 0 }} onClick={e => e.stopPropagation()}>
        <div className="df-mod-head">
          <Icon name="beaker" size={16} style={{ color: 'var(--accent)' }} />
          <h3 className="modal-title" style={{ margin: 0 }}>Pipeline templates</h3>
          <div style={{ flex: 1 }}></div>
          <button className="iconbtn-sm" onClick={onClose}><Icon name="close" size={12} /></button>
        </div>
        <div className="df-templates-grid">
          {templates.map(t => (
            <button key={t.id} className={cx('df-template', `family-${t.accent}`)} onClick={() => onPick(t)}>
              <div className="df-template-h">
                <span className={cx('df-node-ic', `family-${t.accent}`)}><Icon name={t.icon} size={14} /></span>
                <b className="df-template-name">{t.name}</b>
              </div>
              <div className="df-template-desc">{t.desc}</div>
              <div className="df-template-chain">
                {(t.nodeKinds || t.node_kinds || []).map((k, i) => {
                  const d = DF_NODE_BY_KIND[k];
                  return (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      {i > 0 && <Icon name="chevron-right" size={9} style={{ color: 'var(--text-3)' }} />}
                      <span className={cx('df-template-pill', `family-${d?.family}`)}>
                        <Icon name={d?.icon || 'dot'} size={9} />
                        {d?.name}
                      </span>
                    </span>
                  );
                })}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

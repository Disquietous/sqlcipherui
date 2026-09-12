import { useEffect, useState } from 'react';
import { Icon } from '../icons/Icon';
import { getTemplates } from '../../api/dataflow';
import { DF_NODE_BY_KIND } from './catalog';
import { DFField, DFModal } from './DFFormWidgets';

const cx = (...xs) => xs.filter(Boolean).join(' ');

function KindChain({ kinds }) {
  return (
    <div className="df-template-chain">
      {kinds.map((k, i) => {
        const d = DF_NODE_BY_KIND[k];
        return (
          <span key={`${k}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            {i > 0 && <Icon name="chevron-right" size={9} style={{ color: 'var(--text-3)' }} />}
            {d ? (
              <span className={cx('df-template-pill', `family-${d.family}`)} title={d.desc}>
                <Icon name={d.icon} size={9} />
                {d.name}
              </span>
            ) : (
              <span className="df-template-pill is-unknown" title={`Unknown node kind: ${k}`}>?</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function DFTemplatesModal({ onClose, onPick, busy }) {
  const [state, setState] = useState({ templates: [], loading: true, error: null });
  const [picked, setPicked] = useState(null);
  const [name, setName] = useState('');

  useEffect(() => {
    let cancelled = false;
    getTemplates()
      .then(data => { if (!cancelled) setState({ templates: Array.isArray(data) ? data : [], loading: false, error: null }); })
      .catch(e => { if (!cancelled) setState({ templates: [], loading: false, error: e.message }); });
    return () => { cancelled = true; };
  }, []);

  const choose = (t) => { setPicked(t); setName(t.name); };

  const create = (e) => {
    e?.preventDefault();
    const n = name.trim();
    if (!picked || !n || busy) return;
    onPick(picked, n);
  };

  const kindsOf = (t) => t.node_kinds || t.nodeKinds || (t.definition?.nodes || []).map(n => n.kind);

  return (
    <DFModal
      title="Pipeline templates"
      icon={<Icon name="beaker" size={16} style={{ color: 'var(--accent)' }} />}
      onClose={onClose}
      width={720}
      flush
    >
      {state.loading && <div className="df-empty">Loading templates…</div>}
      {state.error && (
        <div className="df-callout df-callout-err" style={{ margin: 18 }} role="alert">
          <Icon name="alert" size={13} />
          <div><b>Could not load templates</b><div className="small mono">{state.error}</div></div>
        </div>
      )}
      {!state.loading && !state.error && state.templates.length === 0 && <div className="df-empty">No templates available.</div>}

      {!picked && state.templates.length > 0 && (
        <div className="df-templates-grid">
          {state.templates.map(t => (
            <button type="button" key={t.id} className={cx('df-template', `family-${t.accent}`)} onClick={() => choose(t)}>
              <div className="df-template-h">
                <span className={cx('df-node-ic', `family-${t.accent}`)}><Icon name={t.icon || 'beaker'} size={14} /></span>
                <b className="df-template-name">{t.name}</b>
              </div>
              <div className="df-template-desc">{t.desc}</div>
              <KindChain kinds={kindsOf(t)} />
            </button>
          ))}
        </div>
      )}

      {picked && (
        <form className="df-template-pick" onSubmit={create}>
          <div className={cx('df-template is-static', `family-${picked.accent}`)}>
            <div className="df-template-h">
              <span className={cx('df-node-ic', `family-${picked.accent}`)}><Icon name={picked.icon || 'beaker'} size={14} /></span>
              <b className="df-template-name">{picked.name}</b>
              <span style={{ flex: 1 }} />
              <button type="button" className="link-btn small" onClick={() => setPicked(null)}>Choose another</button>
            </div>
            <div className="df-template-desc">{picked.desc}</div>
            <KindChain kinds={kindsOf(picked)} />
            <div className="muted small">
              {(picked.definition?.nodes || []).length} nodes, {(picked.definition?.edges || []).length} edges. Node settings (databases, tables, paths) are placeholders you fill in after creation.
            </div>
          </div>
          <DFField label="Pipeline name">
            <input className="df-input" data-autofocus value={name} onChange={e => setName(e.target.value)} aria-label="Pipeline name" required />
          </DFField>
          <div className="df-mod-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
              {busy ? 'Creating…' : 'Create from template'}
            </button>
          </div>
        </form>
      )}
    </DFModal>
  );
}

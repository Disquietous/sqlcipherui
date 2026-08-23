import { Icon } from '../icons/Icon';
import { DF_NODE_BY_KIND } from './catalog';
import { DFInspectorConfig } from './DFInspectorConfig';
import { DFInspectorMapping } from './DFInspectorMapping';
import { DFInspectorSchema } from './DFInspectorSchema';
import { DFInspectorPreview } from './DFInspectorPreview';
import { DFInspectorIssues } from './DFInspectorIssues';

const cx = (...xs) => xs.filter(Boolean).join(' ');

const MAPPING_KINDS = new Set(['tf-map', 'tf-join', 'snk-table', 'snk-ext-db', 'cl-anon']);

export function DFInspector({ node, tab, setTab, onClose }) {
  const def = DF_NODE_BY_KIND[node.kind];
  const isMapping = MAPPING_KINDS.has(node.kind);

  const tabs = [
    { id: 'config', label: 'Config' },
    isMapping && { id: 'mapping', label: 'Mapping' },
    { id: 'schema', label: 'Schema' },
    { id: 'preview', label: 'Preview' },
    { id: 'issues', label: 'Issues', count: node.warn ? 1 : 0 },
  ].filter(Boolean);

  return (
    <div className="df-insp">
      <div className="df-insp-head">
        <span className={cx('df-node-ic', `family-${def.family}`)}>
          <Icon name={def.icon} size={12} />
        </span>
        <span className="df-insp-title">{def.name}</span>
        <span className="muted small mono" style={{ marginLeft: 6 }}>{node.id}</span>
        <div style={{ flex: 1 }}></div>
        <button className="iconbtn-sm" onClick={onClose} title="Close"><Icon name="close" size={11} /></button>
      </div>

      <div className="df-insp-tabs">
        {tabs.map(t => (
          <button key={t.id} className={cx('df-insp-tab', tab === t.id && 'is-active')} onClick={() => setTab(t.id)}>
            {t.label}{t.count > 0 && <span className="df-insp-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="df-insp-body">
        {tab === 'config' && <DFInspectorConfig node={node} />}
        {tab === 'mapping' && <DFInspectorMapping node={node} />}
        {tab === 'schema' && <DFInspectorSchema node={node} />}
        {tab === 'preview' && <DFInspectorPreview node={node} />}
        {tab === 'issues' && <DFInspectorIssues node={node} />}
      </div>
    </div>
  );
}

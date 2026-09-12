import { useEffect, useState } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { runValidation } from './useRunController';
import { DF_NODE_BY_KIND } from './catalog';
import { DFInspectorConfig } from './DFInspectorConfig';
import { DFInspectorMapping } from './DFInspectorMapping';
import { DFInspectorSchema } from './DFInspectorSchema';
import { DFInspectorPreview } from './DFInspectorPreview';
import { DFInspectorIssues } from './DFInspectorIssues';

const cx = (...xs) => xs.filter(Boolean).join(' ');

const MAPPING_KINDS = new Set(['tf-map', 'snk-table']);

/**
 * Re-validate quietly whenever the pipeline is (re)saved, plus on demand.
 * Issues live in the store (`validationIssues`) so the canvas dots, the dock
 * Issues tab, and this inspector all agree.
 */
function useValidation(pipelineId, pipelineDirty) {
  const issues = useDataFlowStore((s) => s.validationIssues);
  const loading = useDataFlowStore((s) => s.validationLoading);
  const [gen, setGen] = useState(0);

  useEffect(() => {
    if (!pipelineId || pipelineDirty) return;
    runValidation({ quiet: true });
  }, [pipelineId, pipelineDirty, gen]);

  return { issues, loading, revalidate: () => setGen(g => g + 1) };
}

export function DFInspector({ node, tab, setTab, onClose }) {
  const pipelineId = useDataFlowStore((s) => s.pipeline?.id);
  const pipelineDirty = useDataFlowStore((s) => s.pipelineDirty);
  const validation = useValidation(pipelineId, pipelineDirty);

  const def = DF_NODE_BY_KIND[node.kind] || { family: 'transform', icon: 'dot', name: node.kind };
  const isMapping = MAPPING_KINDS.has(node.kind);
  const nodeIssues = validation.issues.filter(i => i.node_id === node.id);

  const tabs = [
    { id: 'config', label: 'Config' },
    isMapping && { id: 'mapping', label: 'Mapping' },
    { id: 'schema', label: 'Schema' },
    { id: 'preview', label: 'Preview' },
    { id: 'issues', label: 'Issues', count: nodeIssues.length, level: nodeIssues.some(i => i.level === 'error') ? 'error' : 'warn' },
  ].filter(Boolean);

  // A node kind without a Mapping tab may still have that tab selected from a previous node.
  const activeTab = tabs.some(t => t.id === tab) ? tab : 'config';

  return (
    <aside className="df-insp" aria-label="Node inspector">
      <div className="df-insp-head">
        <span className={cx('df-node-ic', `family-${def.family}`)}>
          <Icon name={def.icon} size={12} />
        </span>
        <span className="df-insp-title">{def.name}</span>
        <span className="muted small mono" style={{ marginLeft: 6 }}>{node.id}</span>
        <div style={{ flex: 1 }}></div>
        <button type="button" className="iconbtn-sm" onClick={onClose} title="Close inspector" aria-label="Close inspector">
          <Icon name="close" size={11} />
        </button>
      </div>

      <div className="df-insp-tabs" role="tablist">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={cx('df-insp-tab', activeTab === t.id && 'is-active')}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count > 0 && <span className={cx('df-insp-tab-count', t.level === 'error' && 'is-error')}>{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="df-insp-body" role="tabpanel">
        {activeTab === 'config' && <DFInspectorConfig node={node} />}
        {activeTab === 'mapping' && <DFInspectorMapping node={node} />}
        {activeTab === 'schema' && <DFInspectorSchema node={node} />}
        {activeTab === 'preview' && <DFInspectorPreview node={node} />}
        {activeTab === 'issues' && (
          <DFInspectorIssues
            issues={nodeIssues}
            loading={validation.loading}
            stale={pipelineDirty}
            onRevalidate={validation.revalidate}
          />
        )}
      </div>
    </aside>
  );
}

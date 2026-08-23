import { useEffect, useCallback } from 'react';
import { useDataFlowStore } from '../../stores/dataflow';
import { getPipelines, getDfConnections, createPipeline } from '../../api/dataflow';
import { DFTopBar } from './DFTopBar';
import { DFHome } from './DFHome';
import { DFEditor } from './DFEditor';
import { DFGuide } from './DFGuide';
import { DFNewModal } from './DFNewModal';
import { DFTemplatesModal } from './DFTemplatesModal';
import { DFConnectionsPanel } from './DFConnectionsPanel';
import { DF_NODE_BY_KIND } from './catalog';

function filterUnknownNodes(pipeline) {
  if (!pipeline?.definition?.nodes) return pipeline;
  const nodes = pipeline.definition.nodes.filter(n => DF_NODE_BY_KIND[n.kind]);
  if (nodes.length === pipeline.definition.nodes.length) return pipeline;
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = (pipeline.definition.edges || []).filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));
  return { ...pipeline, definition: { ...pipeline.definition, nodes, edges } };
}

export function DataFlowsMode() {
  const view = useDataFlowStore((s) => s.view);
  const modal = useDataFlowStore((s) => s.modal);
  const setPipelines = useDataFlowStore((s) => s.setPipelines);
  const setPipelinesLoading = useDataFlowStore((s) => s.setPipelinesLoading);
  const setDfConnections = useDataFlowStore((s) => s.setDfConnections);
  const setModal = useDataFlowStore((s) => s.setModal);
  const openPipeline = useDataFlowStore((s) => s.openPipeline);

  const reload = useCallback(async () => {
    setPipelinesLoading(true);
    try {
      const [pipes, conns] = await Promise.all([
        getPipelines(),
        getDfConnections(),
      ]);
      setPipelines(pipes);
      setDfConnections(conns);
    } catch { /* ignore */ }
    setPipelinesLoading(false);
  }, [setPipelines, setPipelinesLoading, setDfConnections]);

  useEffect(() => { reload(); }, []);

  const handlePickBlank = useCallback(async (name) => {
    setModal(null);
    try {
      const pipeline = await createPipeline({ name, description: '' });
      const parsed = {
        ...pipeline,
        definition: typeof pipeline.definition === 'string'
          ? JSON.parse(pipeline.definition)
          : pipeline.definition,
      };
      openPipeline(parsed);
      reload();
    } catch { /* ignore */ }
  }, [setModal, openPipeline, reload]);

  const handlePickTemplate = useCallback(async (template) => {
    setModal(null);
    try {
      const pipeline = await createPipeline({
        name: template.name,
        description: template.description || '',
        definition: template.definition,
      });
      const parsed = {
        ...pipeline,
        definition: typeof pipeline.definition === 'string'
          ? JSON.parse(pipeline.definition)
          : pipeline.definition,
      };
      openPipeline(parsed);
      reload();
    } catch { /* ignore */ }
  }, [setModal, openPipeline, reload]);

  const handleOpenPipeline = useCallback((pipeline) => {
    const parsed = filterUnknownNodes({
      ...pipeline,
      definition: typeof pipeline.definition === 'string'
        ? JSON.parse(pipeline.definition)
        : pipeline.definition,
    });
    openPipeline(parsed);
  }, [openPipeline]);

  return (
    <div className="df-app">
      <DFTopBar />
      <div className="df-body">
        {view === 'home' && <DFHome onOpenPipeline={handleOpenPipeline} />}
        {view === 'editor' && <DFEditor />}
        {view === 'guide' && <DFGuide />}
      </div>

      {modal === 'new' && (
        <DFNewModal
          onClose={() => setModal(null)}
          onPickBlank={handlePickBlank}
          onPickTemplate={() => setModal('templates')}
        />
      )}
      {modal === 'templates' && (
        <DFTemplatesModal
          onClose={() => setModal(null)}
          onPick={handlePickTemplate}
        />
      )}
      {modal === 'connections' && (
        <DFConnectionsPanel onClose={() => setModal(null)} />
      )}
    </div>
  );
}

import { useEffect, useCallback, useRef, useState } from 'react';
import { useDataFlowStore } from '../../stores/dataflow';
import { getPipelines, getDfConnections, createPipeline, getSchema } from '../../api/dataflow';
import { DFTopBar } from './DFTopBar';
import { DFHome } from './DFHome';
import { DFEditor } from './DFEditor';
import { DFGuide } from './DFGuide';
import { DFNewModal } from './DFNewModal';
import { DFTemplatesModal } from './DFTemplatesModal';
import { DFConnectionsPanel } from './DFConnectionsPanel';
import DFToasts from './DFToasts';
import { DF_NODE_BY_KIND } from './catalog';

function filterUnknownNodes(pipeline) {
  if (!pipeline?.definition?.nodes) return pipeline;
  const nodes = pipeline.definition.nodes.filter(n => DF_NODE_BY_KIND[n.kind]);
  if (nodes.length === pipeline.definition.nodes.length) return pipeline;
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = (pipeline.definition.edges || []).filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));
  return { ...pipeline, definition: { ...pipeline.definition, nodes, edges } };
}

function parseDefinition(pipeline) {
  return {
    ...pipeline,
    definition: typeof pipeline.definition === 'string' ? JSON.parse(pipeline.definition) : (pipeline.definition || { nodes: [], edges: [] }),
  };
}

const toast = (t) => useDataFlowStore.getState().pushToast(t);

/**
 * Background schema inference: runs 600 ms after a pipeline is opened and
 * after every successful save (pipelineDirty true → false). Never blocks UI.
 */
function useSchemaInference() {
  const pipelineId = useDataFlowStore((s) => s.pipeline?.id);
  const pipelineDirty = useDataFlowStore((s) => s.pipelineDirty);
  const prev = useRef({ id: null, dirty: false });
  const lastError = useRef(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = { id: pipelineId, dirty: pipelineDirty };
    if (!pipelineId) return;

    const opened = before.id !== pipelineId;
    const saved = !opened && before.dirty && !pipelineDirty;
    if (!opened && !saved) return;

    const timer = setTimeout(async () => {
      const store = useDataFlowStore.getState();
      if (store.pipeline?.id !== pipelineId) return;
      store.setNodeColumnsLoading(true);
      try {
        const map = await getSchema(pipelineId);
        const now = useDataFlowStore.getState();
        if (now.pipeline?.id === pipelineId) now.setNodeColumns(map || {});
        lastError.current = null;
      } catch (e) {
        if (lastError.current !== e.message) {
          lastError.current = e.message;
          toast({ level: 'error', message: `Schema inference failed: ${e.message}` });
        }
      } finally {
        useDataFlowStore.getState().setNodeColumnsLoading(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [pipelineId, pipelineDirty]);
}

export function DataFlowsMode() {
  const view = useDataFlowStore((s) => s.view);
  const modal = useDataFlowStore((s) => s.modal);
  const setPipelines = useDataFlowStore((s) => s.setPipelines);
  const setPipelinesLoading = useDataFlowStore((s) => s.setPipelinesLoading);
  const setDfConnections = useDataFlowStore((s) => s.setDfConnections);
  const setModal = useDataFlowStore((s) => s.setModal);
  const openPipeline = useDataFlowStore((s) => s.openPipeline);
  const [creating, setCreating] = useState(false);

  useSchemaInference();

  const reload = useCallback(async () => {
    setPipelinesLoading(true);
    try {
      const [pipes, conns] = await Promise.all([getPipelines(), getDfConnections()]);
      setPipelines(pipes);
      setDfConnections(conns);
    } catch (e) {
      toast({ level: 'error', message: `Could not load pipelines: ${e.message}` });
    } finally {
      setPipelinesLoading(false);
    }
  }, [setPipelines, setPipelinesLoading, setDfConnections]);

  useEffect(() => { reload(); }, [reload]);

  const createAndOpen = useCallback(async (payload, label) => {
    setCreating(true);
    try {
      const pipeline = await createPipeline(payload);
      openPipeline(filterUnknownNodes(parseDefinition(pipeline)));
      setModal(null);
      reload();
    } catch (e) {
      toast({ level: 'error', message: `Could not create ${label}: ${e.message}` });
    } finally {
      setCreating(false);
    }
  }, [openPipeline, setModal, reload]);

  const handleCreateBlank = useCallback(({ name, description, tags }) => {
    createAndOpen({ name, description: description || '', tags: tags || [] }, 'pipeline');
  }, [createAndOpen]);

  const handlePickTemplate = useCallback((template, name) => {
    createAndOpen({
      name: name || template.name,
      description: template.desc || template.description || '',
      tags: ['template'],
      definition: template.definition || { nodes: [], edges: [] },
    }, `pipeline from "${template.name}"`);
  }, [createAndOpen]);

  const handleOpenPipeline = useCallback((pipeline) => {
    openPipeline(filterUnknownNodes(parseDefinition(pipeline)));
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
          onCreate={handleCreateBlank}
          onPickTemplate={() => setModal('templates')}
          busy={creating}
        />
      )}
      {modal === 'templates' && (
        <DFTemplatesModal
          onClose={() => setModal(null)}
          onPick={handlePickTemplate}
          busy={creating}
        />
      )}
      {modal === 'connections' && (
        <DFConnectionsPanel onClose={() => setModal(null)} />
      )}

      <DFToasts />
    </div>
  );
}

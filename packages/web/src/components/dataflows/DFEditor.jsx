import { useEffect, useRef, useCallback } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { updatePipeline, streamRun } from '../../api/dataflow';
import { DFNodeLibrary } from './DFNodeLibrary';
import { DFCanvas } from './DFCanvas';
import { DFInspector } from './DFInspector';
import { DFDock } from './DFDock';

let nodeCounter = Date.now();

export function DFEditor() {
  const pipeline = useDataFlowStore((s) => s.pipeline);
  const selectedNodeId = useDataFlowStore((s) => s.selectedNodeId);
  const libraryOpen = useDataFlowStore((s) => s.libraryOpen);
  const inspectorOpen = useDataFlowStore((s) => s.inspectorOpen);
  const inspectorTab = useDataFlowStore((s) => s.inspectorTab);
  const dockTab = useDataFlowStore((s) => s.dockTab);
  const dockHeight = useDataFlowStore((s) => s.dockHeight);
  const pipelineDirty = useDataFlowStore((s) => s.pipelineDirty);
  const selectNode = useDataFlowStore((s) => s.selectNode);
  const setLibraryOpen = useDataFlowStore((s) => s.setLibraryOpen);
  const setInspectorOpen = useDataFlowStore((s) => s.setInspectorOpen);
  const setInspectorTab = useDataFlowStore((s) => s.setInspectorTab);
  const setDockTab = useDataFlowStore((s) => s.setDockTab);
  const addNode = useDataFlowStore((s) => s.addNode);
  const moveNode = useDataFlowStore((s) => s.moveNode);
  const addEdge = useDataFlowStore((s) => s.addEdge);
  const removeNode = useDataFlowStore((s) => s.removeNode);
  const removeEdge = useDataFlowStore((s) => s.removeEdge);
  const setPipelineDirty = useDataFlowStore((s) => s.setPipelineDirty);

  const saveTimer = useRef(null);

  // Auto-save
  useEffect(() => {
    if (!pipelineDirty || !pipeline?.id) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await updatePipeline(pipeline.id, {
          name: pipeline.name,
          description: pipeline.description,
          definition: pipeline.definition,
          starred: pipeline.starred,
        });
        setPipelineDirty(false);
      } catch { /* ignore */ }
    }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [pipelineDirty, pipeline]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === 'Enter') {
        e.preventDefault();
        triggerRun();
      }
      if (meta && e.key === 's') {
        e.preventDefault();
        forceSave();
      }
      if (meta && e.shiftKey && e.key === 'z') {
        e.preventDefault();
        useDataFlowStore.getState().redo();
      } else if (meta && e.key === 'z') {
        e.preventDefault();
        useDataFlowStore.getState().undo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const forceSave = useCallback(async () => {
    const s = useDataFlowStore.getState();
    if (!s.pipeline?.id) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      await updatePipeline(s.pipeline.id, {
        name: s.pipeline.name,
        description: s.pipeline.description,
        definition: s.pipeline.definition,
        starred: s.pipeline.starred,
      });
      setPipelineDirty(false);
    } catch { /* ignore */ }
  }, [setPipelineDirty]);

  const triggerRun = useCallback(() => {
    const s = useDataFlowStore.getState();
    if (!s.pipeline?.id || s.isRunning) return;
    s.setIsRunning(true);
    s.setDockTab('log');
    s.appendRunEvent({
      type: 'info', level: 'info',
      message: `Starting ${s.runMode} run...`,
      timestamp: new Date().toISOString(),
    });
    streamRun(
      s.pipeline.id,
      { mode: s.runMode, transactional: s.transactional, streaming_counters: s.streamingCounters },
      (event) => {
        const st = useDataFlowStore.getState();
        st.appendRunEvent(event);
        if (event.type === 'progress' && event.node_id) {
          st.updateNodeCounter(event.node_id, event.in_rows ?? 0, event.out_rows ?? 0);
        }
        if (event.type === 'edge_progress' && event.from && event.to) {
          st.updateEdgeCounter(event.from, event.to, event.rows ?? 0);
        }
      },
      () => {
        useDataFlowStore.getState().setIsRunning(false);
        useDataFlowStore.getState().appendRunEvent({
          type: 'info', level: 'info',
          message: 'Run complete.',
          timestamp: new Date().toISOString(),
        });
      },
    );
  }, []);

  const handleAddNode = useCallback(({ kind, x, y }) => {
    const id = `n${++nodeCounter}`;
    addNode({ id, kind, x, y, summary: '', config: {} });
    selectNode(id);
    setInspectorOpen(true);
  }, [addNode, selectNode, setInspectorOpen]);

  const handleSelect = useCallback((id) => {
    selectNode(id);
    if (id) setInspectorOpen(true);
  }, [selectNode, setInspectorOpen]);

  if (!pipeline || !pipeline.definition) return null;

  const nodes = pipeline.definition.nodes || [];
  const edges = pipeline.definition.edges || [];
  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const pipelineView = { nodes, edges };

  return (
    <div className="df-editor">
      <div className="df-editor-body">
        {libraryOpen && <DFNodeLibrary onToggle={() => setLibraryOpen(false)} />}
        {!libraryOpen && (
          <button className="df-collapsed-rail" onClick={() => setLibraryOpen(true)} title="Open node library">
            <Icon name="plus" size={12} />
          </button>
        )}

        <div className="df-canvas-col">
          <DFCanvas
            pipeline={pipelineView}
            selected={selectedNodeId}
            onSelect={handleSelect}
            onAddNode={handleAddNode}
            onMoveNode={moveNode}
            onAddEdge={addEdge}
            onRemoveNode={removeNode}
            onRemoveEdge={removeEdge}
          />
          <DFDock
            tab={dockTab}
            setTab={setDockTab}
            height={dockHeight}
            pipeline={pipelineView}
            selectedNode={selectedNode}
          />
        </div>

        {inspectorOpen && selectedNode && (
          <DFInspector
            node={selectedNode}
            tab={inspectorTab}
            setTab={setInspectorTab}
            onClose={() => setInspectorOpen(false)}
          />
        )}
        {!inspectorOpen && (
          <button className="df-collapsed-rail right" onClick={() => setInspectorOpen(true)} title="Open inspector">
            <Icon name="sliders" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

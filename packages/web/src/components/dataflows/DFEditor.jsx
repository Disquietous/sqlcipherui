import { useEffect, useCallback } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { DFNodeLibrary } from './DFNodeLibrary';
import { DFCanvas } from './DFCanvas';
import { DFInspector } from './DFInspector';
import { DFDock } from './DFDock';
import { useAutosave, useRunController } from './useRunController';
import { newNodeId, duplicateSelection, isEditableTarget } from './graphUtils';

export function DFEditor() {
  const pipeline = useDataFlowStore((s) => s.pipeline);
  const selectedNodeId = useDataFlowStore((s) => s.selectedNodeId);
  const libraryOpen = useDataFlowStore((s) => s.libraryOpen);
  const inspectorOpen = useDataFlowStore((s) => s.inspectorOpen);
  const inspectorTab = useDataFlowStore((s) => s.inspectorTab);
  const dockTab = useDataFlowStore((s) => s.dockTab);
  const dockHeight = useDataFlowStore((s) => s.dockHeight);
  const selectNode = useDataFlowStore((s) => s.selectNode);
  const setLibraryOpen = useDataFlowStore((s) => s.setLibraryOpen);
  const setInspectorOpen = useDataFlowStore((s) => s.setInspectorOpen);
  const setInspectorTab = useDataFlowStore((s) => s.setInspectorTab);
  const setDockTab = useDataFlowStore((s) => s.setDockTab);
  const addNode = useDataFlowStore((s) => s.addNode);

  useAutosave();
  const { triggerRun, forceSave } = useRunController();

  // Keyboard shortcuts (skipped while typing in a field or when a modal is open).
  useEffect(() => {
    const handler = (e) => {
      if (isEditableTarget(e.target)) return;
      const st = useDataFlowStore.getState();
      if (st.modal) return;
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (meta && e.key === 'Enter') { e.preventDefault(); triggerRun(); return; }
      if (meta && key === 's') { e.preventDefault(); forceSave(); return; }
      if (meta && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo(); else st.undo();
        return;
      }
      if (meta && key === 'd') { e.preventDefault(); duplicateSelection(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selectedEdge) {
          e.preventDefault();
          st.removeEdge(st.selectedEdge.from, st.selectedEdge.to, st.selectedEdge.fromPort || 'out');
        } else if (st.selectedNodeIds.length) {
          e.preventDefault();
          st.removeNodes(st.selectedNodeIds);
        }
        return;
      }
      if (e.key === 'Escape') st.clearSelection();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [triggerRun, forceSave]);

  const handleAddNode = useCallback(({ kind, x, y }) => {
    const id = newNodeId();
    addNode({ id, kind, x, y, summary: '', config: {} });
    selectNode(id);
    setInspectorOpen(true);
  }, [addNode, selectNode, setInspectorOpen]);

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
          <button className="df-collapsed-rail" onClick={() => setLibraryOpen(true)} title="Open node library" aria-label="Open node library">
            <Icon name="plus" size={12} />
          </button>
        )}

        <div className="df-canvas-col">
          <DFCanvas pipeline={pipelineView} onAddNode={handleAddNode} />
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
          <button className="df-collapsed-rail right" onClick={() => setInspectorOpen(true)} title="Open inspector" aria-label="Open inspector">
            <Icon name="sliders" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

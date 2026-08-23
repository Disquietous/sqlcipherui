import { create } from 'zustand';

const MAX_UNDO = 50;

function snapshot(pipeline) {
  if (!pipeline?.definition) return null;
  return JSON.stringify(pipeline.definition);
}

export const useDataFlowStore = create((set, get) => ({
  view: 'home',
  modal: null,

  pipelines: [],
  pipelinesLoading: false,

  pipeline: null,
  pipelineDirty: false,

  undoStack: [],
  redoStack: [],

  selectedNodeId: null,
  libraryOpen: true,
  inspectorOpen: true,
  inspectorTab: 'config',
  dockTab: 'preview',
  dockHeight: 260,

  runMode: 'full',
  transactional: true,
  streamingCounters: true,
  isRunning: false,
  runEvents: [],
  nodeCounters: {},
  edgeCounters: {},

  dfConnections: [],
  runs: [],
  previewData: {},
  nodeColumns: {},
  mappingData: null,

  setView: (view) => set({ view }),
  setModal: (modal) => set({ modal }),
  setLibraryOpen: (v) => set({ libraryOpen: v }),
  setInspectorOpen: (v) => set({ inspectorOpen: v }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setDockTab: (tab) => set({ dockTab: tab }),
  setDockHeight: (h) => set({ dockHeight: Math.max(100, Math.min(600, h)) }),
  setRunMode: (mode) => set({ runMode: mode }),
  setTransactional: (v) => set({ transactional: v }),
  setStreamingCounters: (v) => set({ streamingCounters: v }),

  _pushUndo: () => {
    const s = get();
    const snap = snapshot(s.pipeline);
    if (!snap) return;
    set({
      undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snap],
      redoStack: [],
    });
  },

  undo: () => {
    const s = get();
    if (s.undoStack.length === 0) return;
    const current = snapshot(s.pipeline);
    const prev = s.undoStack[s.undoStack.length - 1];
    set({
      pipeline: { ...s.pipeline, definition: JSON.parse(prev) },
      undoStack: s.undoStack.slice(0, -1),
      redoStack: current ? [...s.redoStack, current] : s.redoStack,
      pipelineDirty: true,
    });
  },

  redo: () => {
    const s = get();
    if (s.redoStack.length === 0) return;
    const current = snapshot(s.pipeline);
    const next = s.redoStack[s.redoStack.length - 1];
    set({
      pipeline: { ...s.pipeline, definition: JSON.parse(next) },
      redoStack: s.redoStack.slice(0, -1),
      undoStack: current ? [...s.undoStack, current] : s.undoStack,
      pipelineDirty: true,
    });
  },

  openPipeline: (pipeline) => set({
    pipeline,
    view: 'editor',
    selectedNodeId: pipeline?.definition?.nodes?.[0]?.id ?? null,
    pipelineDirty: false,
    runEvents: [],
    nodeCounters: {},
    edgeCounters: {},
    undoStack: [],
    redoStack: [],
  }),

  closePipeline: () => set({
    pipeline: null,
    view: 'home',
    selectedNodeId: null,
    pipelineDirty: false,
    undoStack: [],
    redoStack: [],
  }),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  addNode: (node) => {
    get()._pushUndo();
    set(s => ({
      pipeline: {
        ...s.pipeline,
        definition: {
          ...s.pipeline.definition,
          nodes: [...s.pipeline.definition.nodes, node],
        },
      },
      pipelineDirty: true,
    }));
  },

  moveNode: (nodeId, x, y) => set(s => ({
    pipeline: {
      ...s.pipeline,
      definition: {
        ...s.pipeline.definition,
        nodes: s.pipeline.definition.nodes.map(n =>
          n.id === nodeId ? { ...n, x, y } : n
        ),
      },
    },
    pipelineDirty: true,
  })),

  // Push undo after drag ends (called from DFNode mouseup)
  commitMove: () => {
    get()._pushUndo();
  },

  addEdge: (edge) => {
    get()._pushUndo();
    set(s => ({
      pipeline: {
        ...s.pipeline,
        definition: {
          ...s.pipeline.definition,
          edges: [...s.pipeline.definition.edges, edge],
        },
      },
      pipelineDirty: true,
    }));
  },

  removeNode: (nodeId) => {
    get()._pushUndo();
    set(s => ({
      pipeline: {
        ...s.pipeline,
        definition: {
          ...s.pipeline.definition,
          nodes: s.pipeline.definition.nodes.filter(n => n.id !== nodeId),
          edges: s.pipeline.definition.edges.filter(e =>
            e.from !== nodeId && e.to !== nodeId
          ),
        },
      },
      pipelineDirty: true,
      selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
    }));
  },

  removeEdge: (from, to) => {
    get()._pushUndo();
    set(s => ({
      pipeline: {
        ...s.pipeline,
        definition: {
          ...s.pipeline.definition,
          edges: s.pipeline.definition.edges.filter(e =>
            !(e.from === from && e.to === to)
          ),
        },
      },
      pipelineDirty: true,
    }));
  },

  updateNodeConfig: (nodeId, config) => {
    get()._pushUndo();
    set(s => ({
      pipeline: {
        ...s.pipeline,
        definition: {
          ...s.pipeline.definition,
          nodes: s.pipeline.definition.nodes.map(n =>
            n.id === nodeId ? { ...n, config: { ...n.config, ...config } } : n
          ),
        },
      },
      pipelineDirty: true,
    }));
  },

  updateNodeSummary: (nodeId, summary) => {
    get()._pushUndo();
    set(s => ({
      pipeline: {
        ...s.pipeline,
        definition: {
          ...s.pipeline.definition,
          nodes: s.pipeline.definition.nodes.map(n =>
            n.id === nodeId ? { ...n, summary } : n
          ),
        },
      },
      pipelineDirty: true,
    }));
  },

  toggleStar: () => set(s => ({
    pipeline: s.pipeline ? { ...s.pipeline, starred: s.pipeline.starred ? 0 : 1 } : s.pipeline,
    pipelineDirty: true,
  })),

  setPipelineDirty: (v) => set({ pipelineDirty: v }),

  appendRunEvent: (event) => set(s => ({
    runEvents: [...s.runEvents, event],
  })),

  updateNodeCounter: (nodeId, inRows, outRows) => set(s => ({
    nodeCounters: { ...s.nodeCounters, [nodeId]: { inRows, outRows } },
  })),

  updateEdgeCounter: (from, to, rows) => set(s => ({
    edgeCounters: { ...s.edgeCounters, [`${from}-${to}`]: rows },
  })),

  setIsRunning: (v) => set({ isRunning: v }),
  setPipelines: (pipelines) => set({ pipelines }),
  setPipelinesLoading: (v) => set({ pipelinesLoading: v }),
  setRuns: (runs) => set({ runs }),
  setDfConnections: (dfConnections) => set({ dfConnections }),
  setPreviewData: (nodeId, data) => set(s => ({
    previewData: { ...s.previewData, [nodeId]: data },
  })),
}));

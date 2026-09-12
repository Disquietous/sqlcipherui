import { create } from 'zustand';

const MAX_UNDO = 50;

function snapshot(pipeline) {
  if (!pipeline?.definition) return null;
  return JSON.stringify(pipeline.definition);
}

function mutateDefinition(s, fn) {
  return {
    pipeline: { ...s.pipeline, definition: fn(s.pipeline.definition) },
    pipelineDirty: true,
  };
}

let toastSeq = 0;

export const useDataFlowStore = create((set, get) => ({
  view: 'home',
  modal: null,

  pipelines: [],
  pipelinesLoading: false,
  stats: null,

  pipeline: null,
  pipelineDirty: false,

  undoStack: [],
  redoStack: [],

  // Selection: `selectedNodeId` is the primary (inspector) node; `selectedNodeIds`
  // is the full multi-selection set (always contains selectedNodeId when non-null).
  selectedNodeId: null,
  selectedNodeIds: [],
  selectedEdge: null, // {from, to} | null

  libraryOpen: true,
  inspectorOpen: true,
  inspectorTab: 'config',
  dockTab: 'preview',
  dockHeight: 260,

  runMode: 'full',
  transactional: true,
  streamingCounters: true,
  isRunning: false,
  activeRunId: null,
  runStatus: null,      // {status, total_rows, duration_ms, error} from the last `done` event
  runEvents: [],
  nodeCounters: {},
  edgeCounters: {},

  dfConnections: [],
  runs: [],
  previewData: {},
  nodeColumns: {},      // { [nodeId]: {columns:[{name,type}], error} }
  nodeColumnsLoading: false,
  validationIssues: [], // [{node_id, level:'warn'|'error', message}] from the last validate call
  toasts: [],

  setView: (view) => set({ view }),
  setModal: (modal) => set({ modal }),
  setLibraryOpen: (v) => set({ libraryOpen: v }),
  setInspectorOpen: (v) => set({ inspectorOpen: v }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setDockTab: (tab) => set({ dockTab: tab }),
  setDockHeight: (h) => set({ dockHeight: Math.max(40, Math.min(600, h)) }),
  setRunMode: (mode) => set({ runMode: mode }),
  setTransactional: (v) => set({ transactional: v }),
  setStreamingCounters: (v) => set({ streamingCounters: v }),
  setStats: (stats) => set({ stats }),

  pushToast: ({ level = 'info', message, ttl = 5000 }) => {
    const id = ++toastSeq;
    set(s => ({ toasts: [...s.toasts, { id, level, message }] }));
    if (ttl > 0) setTimeout(() => get().dismissToast(id), ttl);
    return id;
  },
  dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

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

  openPipeline: (pipeline) => {
    const first = pipeline?.definition?.nodes?.[0]?.id ?? null;
    set({
      pipeline,
      view: 'editor',
      selectedNodeId: first,
      selectedNodeIds: first ? [first] : [],
      selectedEdge: null,
      pipelineDirty: false,
      runEvents: [],
      runStatus: null,
      activeRunId: null,
      nodeCounters: {},
      edgeCounters: {},
      nodeColumns: {},
      previewData: {},
      validationIssues: [],
      undoStack: [],
      redoStack: [],
    });
  },

  closePipeline: () => set({
    pipeline: null,
    view: 'home',
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedEdge: null,
    pipelineDirty: false,
    validationIssues: [],
    undoStack: [],
    redoStack: [],
  }),

  /** Replace the pipeline's top-level metadata (name, description, tags, schedule…). */
  updatePipelineMeta: (patch) => set(s => ({
    pipeline: s.pipeline ? { ...s.pipeline, ...patch } : s.pipeline,
    pipelineDirty: true,
  })),

  // ---- selection ----------------------------------------------------------
  selectNode: (nodeId, { additive = false } = {}) => set(s => {
    if (nodeId === null) return { selectedNodeId: null, selectedNodeIds: [], selectedEdge: null };
    if (additive) {
      const has = s.selectedNodeIds.includes(nodeId);
      const ids = has ? s.selectedNodeIds.filter(id => id !== nodeId) : [...s.selectedNodeIds, nodeId];
      return { selectedNodeIds: ids, selectedNodeId: ids[ids.length - 1] ?? null, selectedEdge: null };
    }
    return { selectedNodeId: nodeId, selectedNodeIds: [nodeId], selectedEdge: null };
  }),
  selectNodes: (ids) => set({
    selectedNodeIds: ids,
    selectedNodeId: ids[ids.length - 1] ?? null,
    selectedEdge: null,
  }),
  selectEdge: (edge) => set({ selectedEdge: edge, selectedNodeId: null, selectedNodeIds: [] }),
  clearSelection: () => set({ selectedNodeId: null, selectedNodeIds: [], selectedEdge: null }),

  // ---- graph mutations ----------------------------------------------------
  addNode: (node) => {
    get()._pushUndo();
    set(s => mutateDefinition(s, d => ({ ...d, nodes: [...d.nodes, node] })));
  },

  addNodes: (nodes) => {
    get()._pushUndo();
    set(s => mutateDefinition(s, d => ({ ...d, nodes: [...d.nodes, ...nodes] })));
  },

  /** Move without recording undo (called continuously while dragging). */
  moveNode: (nodeId, x, y) => set(s => mutateDefinition(s, d => ({
    ...d,
    nodes: d.nodes.map(n => n.id === nodeId ? { ...n, x, y } : n),
  }))),

  /** Move several nodes by a delta without recording undo. */
  moveNodesBy: (nodeIds, dx, dy) => set(s => mutateDefinition(s, d => ({
    ...d,
    nodes: d.nodes.map(n => nodeIds.includes(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n),
  }))),

  /**
   * Record an undo step for a completed drag. `beforeSnapshot` is the
   * definition JSON captured at drag start (see DFNode / DFCanvas).
   */
  commitMove: (beforeSnapshot) => {
    if (!beforeSnapshot) return;
    const s = get();
    if (beforeSnapshot === snapshot(s.pipeline)) return;
    set({
      undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), beforeSnapshot],
      redoStack: [],
    });
  },

  addEdge: (edge) => {
    get()._pushUndo();
    set(s => mutateDefinition(s, d => ({
      ...d,
      edges: [...d.edges, { port: null, fromPort: 'out', crossDb: false, ...edge }],
    })));
  },

  removeNode: (nodeId) => get().removeNodes([nodeId]),

  removeNodes: (nodeIds) => {
    if (!nodeIds.length) return;
    get()._pushUndo();
    const gone = new Set(nodeIds);
    set(s => ({
      ...mutateDefinition(s, d => ({
        ...d,
        nodes: d.nodes.filter(n => !gone.has(n.id)),
        edges: d.edges.filter(e => !gone.has(e.from) && !gone.has(e.to)),
      })),
      selectedNodeIds: s.selectedNodeIds.filter(id => !gone.has(id)),
      selectedNodeId: gone.has(s.selectedNodeId) ? null : s.selectedNodeId,
    }));
  },

  removeEdge: (from, to, fromPort) => {
    get()._pushUndo();
    set(s => ({
      ...mutateDefinition(s, d => ({
        ...d,
        edges: d.edges.filter(e =>
          !(e.from === from && e.to === to && (fromPort === undefined || (e.fromPort || 'out') === fromPort))
        ),
      })),
      selectedEdge: s.selectedEdge?.from === from && s.selectedEdge?.to === to ? null : s.selectedEdge,
    }));
  },

  updateEdge: (from, to, patch) => {
    get()._pushUndo();
    set(s => mutateDefinition(s, d => ({
      ...d,
      edges: d.edges.map(e => e.from === from && e.to === to ? { ...e, ...patch } : e),
    })));
  },

  /**
   * Merge config keys into a node. Consecutive edits to the same node within
   * 800ms coalesce into a single undo step so typing is not one step per key.
   */
  updateNodeConfig: (nodeId, config) => {
    const s = get();
    const now = Date.now();
    const last = s._lastConfigEdit;
    if (!(last && last.nodeId === nodeId && now - last.at < 800)) s._pushUndo();
    set(st => ({
      ...mutateDefinition(st, d => ({
        ...d,
        nodes: d.nodes.map(n => n.id === nodeId ? { ...n, config: { ...n.config, ...config } } : n),
      })),
      _lastConfigEdit: { nodeId, at: now },
    }));
  },
  _lastConfigEdit: null,

  /** Replace a node's whole config (used by mapping editors). */
  setNodeConfig: (nodeId, config) => {
    get()._pushUndo();
    set(s => mutateDefinition(s, d => ({
      ...d,
      nodes: d.nodes.map(n => n.id === nodeId ? { ...n, config } : n),
    })));
  },

  updateNodeSummary: (nodeId, summary) => {
    get()._pushUndo();
    set(s => mutateDefinition(s, d => ({
      ...d,
      nodes: d.nodes.map(n => n.id === nodeId ? { ...n, summary } : n),
    })));
  },

  toggleStar: () => set(s => ({
    pipeline: s.pipeline ? { ...s.pipeline, starred: s.pipeline.starred ? 0 : 1 } : s.pipeline,
    pipelineDirty: true,
  })),

  setPipelineDirty: (v) => set({ pipelineDirty: v }),

  // ---- run state ----------------------------------------------------------
  startRun: () => set({
    isRunning: true,
    activeRunId: null,
    runStatus: null,
    runEvents: [],
    nodeCounters: {},
    edgeCounters: {},
  }),
  setActiveRunId: (id) => set({ activeRunId: id }),
  setRunStatus: (runStatus) => set({ runStatus }),
  appendRunEvent: (event) => set(s => ({ runEvents: [...s.runEvents, event] })),
  updateNodeCounter: (nodeId, inRows, outRows) => set(s => ({
    nodeCounters: { ...s.nodeCounters, [nodeId]: { inRows, outRows } },
  })),
  updateEdgeCounter: (from, to, rows) => set(s => ({
    edgeCounters: { ...s.edgeCounters, [`${from}-${to}`]: rows },
  })),
  setIsRunning: (v) => set({ isRunning: v }),

  // ---- data ---------------------------------------------------------------
  setPipelines: (pipelines) => set({ pipelines }),
  setPipelinesLoading: (v) => set({ pipelinesLoading: v }),
  setRuns: (runs) => set({ runs }),
  setDfConnections: (dfConnections) => set({ dfConnections }),
  setPreviewData: (nodeId, data) => set(s => ({
    previewData: { ...s.previewData, [nodeId]: data },
  })),
  setNodeColumns: (nodeColumns) => set({ nodeColumns }),
  setNodeColumnsLoading: (v) => set({ nodeColumnsLoading: v }),
  setValidationIssues: (validationIssues) => set({ validationIssues: validationIssues || [] }),
  validationLoading: false,
  setValidationLoading: (v) => set({ validationLoading: v }),
}));

/** Column list for the upstream side of a node (first input by default). */
export function upstreamColumns(state, nodeId, port) {
  const def = state.pipeline?.definition;
  if (!def) return [];
  const edges = def.edges.filter(e => e.to === nodeId && (port === undefined || (e.port || null) === port));
  const edge = edges[0];
  if (!edge) return [];
  return state.nodeColumns[edge.from]?.columns || [];
}

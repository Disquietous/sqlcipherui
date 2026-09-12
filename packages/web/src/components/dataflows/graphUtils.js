import { useDataFlowStore } from '../../stores/dataflow';
import { DF_NODE_BY_KIND, nodeInputs, nodeOutputs, isSourceKind, isSinkKind } from './catalog';

export const NODE_W = 220;
export const NODE_H = 76;

/** Kinds whose single input port accepts any number of upstream edges. */
export const MULTI_INPUT_KINDS = new Set(['tf-union', 'co-sql']);

let idSeq = 0;
export function newNodeId() {
  idSeq += 1;
  return `n${Date.now().toString(36)}${idSeq.toString(36)}`;
}

export const edgeKey = (e) => `${e.from}-${e.to}`;
export const sameEdge = (a, b) =>
  !!a && !!b && a.from === b.from && a.to === b.to && (a.fromPort || 'out') === (b.fromPort || 'out');

/** The database a node reads/writes: connection id or file path (as string). */
export function dbRef(node) {
  const c = node?.config || {};
  const v = c.conn ?? c.path ?? '';
  return v === null || v === undefined ? '' : String(v);
}

export function isCrossDb(a, b) {
  const ra = dbRef(a), rb = dbRef(b);
  return !!ra && !!rb && ra !== rb;
}

/** Vertical fraction of the node height for the i-th of n ports. */
export function portFraction(i, n) {
  if (n <= 1) return 0.5;
  if (n === 2) return i === 0 ? 0.35 : 0.65;
  return (i + 1) / (n + 1);
}

export function inAnchor(node, port) {
  const ports = nodeInputs(node.kind);
  let i = ports.indexOf(port);
  if (i < 0) i = 0;
  return { x: node.x, y: node.y + NODE_H * portFraction(i, ports.length) };
}

export function outAnchor(node, fromPort) {
  const ports = nodeOutputs(node.kind);
  let i = ports.indexOf(fromPort || 'out');
  if (i < 0) i = 0;
  return { x: node.x + NODE_W, y: node.y + NODE_H * portFraction(i, ports.length) };
}

export function bezierPath(a, b) {
  const dx = Math.max(60, Math.abs(b.x - a.x) * 0.45);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

/** Point at t=0.5 on the same cubic bezierPath() draws. */
export function bezierMid(a, b) {
  const dx = Math.max(60, Math.abs(b.x - a.x) * 0.45);
  const c1 = { x: a.x + dx, y: a.y }, c2 = { x: b.x - dx, y: b.y };
  return {
    x: 0.125 * a.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * b.x,
    y: 0.125 * a.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * b.y,
  };
}

export function nodesBounds(nodes) {
  if (!nodes || nodes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + NODE_W); maxY = Math.max(maxY, n.y + NODE_H);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** True when adding from→to would make the DAG cyclic (a path to→…→from exists). */
export function wouldCreateCycle(edges, from, to) {
  if (from === to) return true;
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
  }
  const seen = new Set();
  const stack = [to];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nxt of out.get(cur) || []) stack.push(nxt);
  }
  return false;
}

/**
 * Validate a prospective connection. `wantPort` is the input port the user
 * dropped on (may be undefined → pick the first free one).
 * Returns { ok: true, edge } or { ok: false, reason }.
 */
export function validateConnection(definition, from, fromPort, to, wantPort) {
  const nodes = definition.nodes || [];
  const edges = definition.edges || [];
  const src = nodes.find(n => n.id === from);
  const dst = nodes.find(n => n.id === to);
  if (!src || !dst) return { ok: false, reason: 'Unknown node' };
  if (from === to) return { ok: false, reason: 'A node cannot connect to itself' };
  if (isSinkKind(src.kind)) return { ok: false, reason: `${DF_NODE_BY_KIND[src.kind].name} is a sink and has no output` };
  if (isSourceKind(dst.kind)) return { ok: false, reason: `${DF_NODE_BY_KIND[dst.kind].name} is a source and takes no input` };

  const outs = nodeOutputs(src.kind);
  const outPort = outs.includes(fromPort) ? fromPort : 'out';
  if (edges.some(e => e.from === from && e.to === to)) {
    return { ok: false, reason: 'These nodes are already connected' };
  }
  if (wouldCreateCycle(edges, from, to)) {
    return { ok: false, reason: 'That connection would create a cycle' };
  }

  const inputs = nodeInputs(dst.kind);
  const incoming = edges.filter(e => e.to === to);
  let port = null;
  if (inputs.length > 1) {
    const used = new Set(incoming.map(e => e.port).filter(Boolean));
    // Legacy edges without a port occupy ports in order.
    incoming.filter(e => !e.port).forEach((_, i) => { if (inputs[i]) used.add(inputs[i]); });
    if (wantPort && inputs.includes(wantPort)) {
      if (used.has(wantPort)) return { ok: false, reason: `Input ${wantPort} of ${DF_NODE_BY_KIND[dst.kind].name} is already connected` };
      port = wantPort;
    } else {
      port = inputs.find(p => !used.has(p)) || null;
      if (!port) return { ok: false, reason: `${DF_NODE_BY_KIND[dst.kind].name} already has all ${inputs.length} inputs connected` };
    }
  } else if (!MULTI_INPUT_KINDS.has(dst.kind) && incoming.length > 0) {
    return { ok: false, reason: `${DF_NODE_BY_KIND[dst.kind].name} already has an input` };
  }

  return {
    ok: true,
    edge: { from, to, port, fromPort: outPort, crossDb: isCrossDb(src, dst) },
  };
}

/**
 * Clone the selected nodes (offset +40,+40) and the edges between them as a
 * single undo step. Selects the clones.
 */
export function duplicateSelection() {
  const s = useDataFlowStore.getState();
  const def = s.pipeline?.definition;
  const ids = s.selectedNodeIds;
  if (!def || !ids.length) return;
  const idMap = new Map();
  const clones = def.nodes.filter(n => ids.includes(n.id)).map(n => {
    const id = newNodeId();
    idMap.set(n.id, id);
    return {
      ...n, id, x: n.x + 40, y: n.y + 40,
      config: JSON.parse(JSON.stringify(n.config || {})),
    };
  });
  if (!clones.length) return;
  const newEdges = def.edges
    .filter(e => idMap.has(e.from) && idMap.has(e.to))
    .map(e => ({ ...e, from: idMap.get(e.from), to: idMap.get(e.to) }));

  s._pushUndo();
  useDataFlowStore.setState(st => ({
    pipeline: {
      ...st.pipeline,
      definition: {
        ...st.pipeline.definition,
        nodes: [...st.pipeline.definition.nodes, ...clones],
        edges: [...st.pipeline.definition.edges, ...newEdges],
      },
    },
    pipelineDirty: true,
  }));
  useDataFlowStore.getState().selectNodes(clones.map(c => c.id));
}

/** True when a keyboard event originates from a text-editing element. */
export function isEditableTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return !!target.closest('[contenteditable="true"], [contenteditable=""]');
}

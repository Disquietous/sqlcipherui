import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Icon } from '../icons/Icon';
import { DFNode } from './DFNode';
import { DFMinimap } from './DFMinimap';
import { DF_NODE_BY_KIND } from './catalog';
import { useDataFlowStore } from '../../stores/dataflow';
import { registerCanvasApi } from './useRunController';
import {
  NODE_W, NODE_H, inAnchor, outAnchor, bezierPath, bezierMid, nodesBounds,
  rectsIntersect, validateConnection, sameEdge, edgeKey, isEditableTarget,
} from './graphUtils';

const cx = (...xs) => xs.filter(Boolean).join(' ');
const MIN_ZOOM = 0.25, MAX_ZOOM = 2, FIT_PAD = 60;
const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

/**
 * Pipeline canvas: pan/zoom, node drag, marquee, wiring, edge selection.
 * Selection lives in the store; `pipeline` is `{nodes, edges}` (the definition).
 */
export function DFCanvas({ pipeline, onAddNode }) {
  const selectedNodeIds = useDataFlowStore((s) => s.selectedNodeIds);
  const selectedEdge = useDataFlowStore((s) => s.selectedEdge);
  const edgeCounters = useDataFlowStore((s) => s.edgeCounters);
  const validationIssues = useDataFlowStore((s) => s.validationIssues);

  const [view, setView] = useState({ x: 40, y: 40, zoom: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [wiring, setWiring] = useState(null);   // {fixedId, side, port, mouse:{x,y}, detach}
  const [marquee, setMarquee] = useState(null); // {x1,y1,x2,y2} in pipeline coords
  const [hoverEdge, setHoverEdge] = useState(null);
  const [panning, setPanning] = useState(false);

  const canvasRef = useRef(null);
  const viewRef = useRef(view);
  const wiringRef = useRef(null);
  useEffect(() => { viewRef.current = view; }, [view]);

  const nodes = useMemo(() => pipeline.nodes || [], [pipeline.nodes]);
  const edges = useMemo(() => pipeline.edges || [], [pipeline.edges]);
  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const issueByNode = useMemo(() => {
    const m = {};
    for (const i of validationIssues || []) {
      if (!i.node_id) continue;
      if (i.level === 'error' || !m[i.node_id]) m[i.node_id] = i.level === 'error' ? 'error' : 'warn';
    }
    return m;
  }, [validationIssues]);
  const selectedSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

  // ---- coordinate helpers ---------------------------------------------------
  const clientToPipeline = useCallback((clientX, clientY) => {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  }, []);

  // ---- size tracking --------------------------------------------------------
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- zoom / fit -------------------------------------------------------------
  const zoomAt = useCallback((factor, cx0, cy0) => {
    setView(v => {
      const nz = clampZoom(v.zoom * factor);
      const k = nz / v.zoom;
      return { zoom: nz, x: cx0 - (cx0 - v.x) * k, y: cy0 - (cy0 - v.y) * k };
    });
  }, []);

  const zoomIn = useCallback(() => {
    const el = canvasRef.current; if (!el) return;
    zoomAt(1.2, el.clientWidth / 2, el.clientHeight / 2);
  }, [zoomAt]);

  const zoomOut = useCallback(() => {
    const el = canvasRef.current; if (!el) return;
    zoomAt(1 / 1.2, el.clientWidth / 2, el.clientHeight / 2);
  }, [zoomAt]);

  const fit = useCallback(() => {
    const el = canvasRef.current; if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    const ns = useDataFlowStore.getState().pipeline?.definition?.nodes || [];
    const b = nodesBounds(ns);
    if (!b) { setView({ x: 40, y: 40, zoom: 1 }); return; }
    const zoom = clampZoom(Math.min((W - FIT_PAD * 2) / b.w, (H - FIT_PAD * 2) / b.h, 1.25));
    setView({
      zoom,
      x: (W - b.w * zoom) / 2 - b.minX * zoom,
      y: (H - b.h * zoom) / 2 - b.minY * zoom,
    });
  }, []);

  const centerOn = useCallback((px, py) => {
    const el = canvasRef.current; if (!el) return;
    setView(v => ({ ...v, x: el.clientWidth / 2 - px * v.zoom, y: el.clientHeight / 2 - py * v.zoom }));
  }, []);

  useEffect(() => {
    registerCanvasApi({ fit, zoomIn, zoomOut });
    return () => registerCanvasApi(null);
  }, [fit, zoomIn, zoomOut]);

  // Fit once after the first layout.
  useEffect(() => {
    const id = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(id);
  }, [fit]);

  // Wheel: ctrl/⌘ zooms around the cursor, plain wheel pans. Native listener so
  // preventDefault works (React registers wheel as passive).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else {
        setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // ---- empty-canvas press: pan, or shift+drag marquee -------------------------
  const handleCanvasMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.df-node, .df-canvas-controls, .df-canvas-mini, .df-edge-hit, .df-edge-handle, .df-edge-delete')) return;
    canvasRef.current?.focus({ preventScroll: true });
    const start = { x: e.clientX, y: e.clientY };

    if (e.shiftKey) {
      const p0 = clientToPipeline(e.clientX, e.clientY);
      let cur = { x1: p0.x, y1: p0.y, x2: p0.x, y2: p0.y };
      setMarquee(cur);
      const move = (ev) => {
        const p = clientToPipeline(ev.clientX, ev.clientY);
        cur = { ...cur, x2: p.x, y2: p.y };
        setMarquee(cur);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        setMarquee(null);
        const rect = {
          x: Math.min(cur.x1, cur.x2), y: Math.min(cur.y1, cur.y2),
          w: Math.abs(cur.x2 - cur.x1), h: Math.abs(cur.y2 - cur.y1),
        };
        const ns = useDataFlowStore.getState().pipeline?.definition?.nodes || [];
        const ids = ns.filter(n => rectsIntersect(rect, { x: n.x, y: n.y, w: NODE_W, h: NODE_H })).map(n => n.id);
        useDataFlowStore.getState().selectNodes(ids);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      return;
    }

    const startView = viewRef.current;
    let moved = false;
    setPanning(true);
    const move = (ev) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      setView(v => ({ ...v, x: startView.x + dx, y: startView.y + dy }));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setPanning(false);
      if (!moved) useDataFlowStore.getState().clearSelection();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [clientToPipeline]);

  // ---- node drag (moves the whole selection, zoom-corrected) --------------------
  const handleNodeMouseDown = useCallback((nodeId, e) => {
    const st = useDataFlowStore.getState();
    if (e.shiftKey) { st.selectNode(nodeId, { additive: true }); return; }
    if (!st.selectedNodeIds.includes(nodeId)) st.selectNode(nodeId);
    st.setInspectorOpen(true);
    const ids = useDataFlowStore.getState().selectedNodeIds;
    const before = JSON.stringify(useDataFlowStore.getState().pipeline.definition);
    const zoom = viewRef.current.zoom;
    const start = { x: e.clientX, y: e.clientY };
    let appliedX = 0, appliedY = 0;
    const move = (ev) => {
      const tx = Math.round((ev.clientX - start.x) / zoom);
      const ty = Math.round((ev.clientY - start.y) / zoom);
      const ddx = tx - appliedX, ddy = ty - appliedY;
      if (!ddx && !ddy) return;
      appliedX = tx; appliedY = ty;
      useDataFlowStore.getState().moveNodesBy(ids, ddx, ddy);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      useDataFlowStore.getState().commitMove(before);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, []);

  // ---- wiring -------------------------------------------------------------------
  const beginWiring = useCallback((fixedId, side, port, e, detach = null) => {
    const p = clientToPipeline(e.clientX, e.clientY);
    const w = { fixedId, side, port, mouse: p, detach };
    wiringRef.current = w;
    setWiring(w);
    const move = (ev) => {
      const mp = clientToPipeline(ev.clientX, ev.clientY);
      const next = wiringRef.current ? { ...wiringRef.current, mouse: mp } : null;
      wiringRef.current = next;
      setWiring(next);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      // A port/node mouseup completes the wire first; this just clears leftovers.
      wiringRef.current = null;
      setWiring(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [clientToPipeline]);

  /** Complete a wiring drag onto `targetId`. `side` is the port side dropped on. */
  const finishWiring = useCallback((targetId, side, port) => {
    const w = wiringRef.current;
    if (!w) return;
    wiringRef.current = null;
    setWiring(null);
    let from, fromPort, to, wantPort;
    if (w.side === 'out' && side === 'in') { from = w.fixedId; fromPort = w.port; to = targetId; wantPort = port; }
    else if (w.side === 'in' && side === 'out') { from = targetId; fromPort = port; to = w.fixedId; wantPort = w.port; }
    else return;

    const st = useDataFlowStore.getState();
    const def = st.pipeline?.definition;
    if (!def) return;
    const edgesForCheck = w.detach ? def.edges.filter(e => !sameEdge(e, w.detach)) : def.edges;
    if (w.detach && sameEdge(w.detach, { from, to, fromPort })) return; // dropped back where it was
    const res = validateConnection({ ...def, edges: edgesForCheck }, from, fromPort, to, wantPort);
    if (!res.ok) {
      st.pushToast({ level: 'error', message: res.reason });
      return;
    }
    if (w.detach) {
      const matches = def.edges.filter(e => e.from === w.detach.from && e.to === w.detach.to);
      if (matches.length === 1) {
        st.updateEdge(w.detach.from, w.detach.to, res.edge);
      } else {
        st.removeEdge(w.detach.from, w.detach.to, w.detach.fromPort || 'out');
        useDataFlowStore.getState().addEdge(res.edge);
      }
    } else {
      st.addEdge(res.edge);
    }
    useDataFlowStore.getState().selectEdge({ from: res.edge.from, to: res.edge.to, fromPort: res.edge.fromPort });
  }, []);

  const handlePortMouseDown = useCallback((nodeId, side, port, e) => {
    if (e.button !== 0) return;
    beginWiring(nodeId, side, port, e);
  }, [beginWiring]);

  const handlePortMouseUp = useCallback((nodeId, side, port) => {
    finishWiring(nodeId, side, port);
  }, [finishWiring]);

  // Dropping a wire anywhere on a node body connects to the first free port.
  const handleNodeMouseUp = useCallback((nodeId) => {
    const w = wiringRef.current;
    if (!w) return;
    finishWiring(nodeId, w.side === 'out' ? 'in' : 'out', undefined);
  }, [finishWiring]);

  // Grab an existing edge's end to re-route it.
  const handleEdgeEndGrab = useCallback((edge, e) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    beginWiring(edge.from, 'out', edge.fromPort || 'out', e, edge);
  }, [beginWiring]);

  const handleEdgeStartGrab = useCallback((edge, e) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    beginWiring(edge.to, 'in', edge.port || null, e, edge);
  }, [beginWiring]);

  // ---- library drop ---------------------------------------------------------------
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('application/x-df-node') || e.dataTransfer.getData('text/plain');
    if (!kind || !DF_NODE_BY_KIND[kind]) return;
    const pt = clientToPipeline(e.clientX, e.clientY);
    onAddNode?.({ kind, x: Math.round(pt.x - NODE_W / 2), y: Math.round(pt.y - NODE_H / 2) });
  }, [onAddNode, clientToPipeline]);

  // ---- keyboard: arrow keys nudge the selection ----------------------------------
  const handleKeyDown = useCallback((e) => {
    const dir = ARROWS[e.key];
    if (!dir || isEditableTarget(e.target)) return;
    const st = useDataFlowStore.getState();
    if (!st.selectedNodeIds.length || !st.pipeline?.definition) return;
    e.preventDefault();
    const step = e.shiftKey ? 1 : 10;
    const before = JSON.stringify(st.pipeline.definition);
    st.moveNodesBy(st.selectedNodeIds, dir[0] * step, dir[1] * step);
    useDataFlowStore.getState().commitMove(before);
  }, []);

  // ---- render ----------------------------------------------------------------------
  const wiringPath = wiring && (() => {
    const fixed = nodeById.get(wiring.fixedId);
    if (!fixed) return null;
    if (wiring.side === 'out') return bezierPath(outAnchor(fixed, wiring.port), wiring.mouse);
    return bezierPath(wiring.mouse, inAnchor(fixed, wiring.port));
  })();

  const gridSize = 20 * view.zoom;

  return (
    <div
      className={cx('df-canvas', panning && 'is-panning', wiring && 'is-wiring')}
      ref={canvasRef}
      tabIndex={0}
      role="application"
      aria-label="Pipeline canvas"
      onMouseDown={handleCanvasMouseDown}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      <div
        className="df-canvas-inner"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        <svg className="df-edges" width="1" height="1">
          <defs>
            <linearGradient id="df-grad-cross" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--ok)" />
              <stop offset="100%" stopColor="var(--accent)" />
            </linearGradient>
            <marker id="df-arrow" markerWidth="10" markerHeight="10" refX="7" refY="5" orient="auto">
              <path d="M0 0L8 5L0 10Z" fill="var(--text-3)" />
            </marker>
            <marker id="df-arrow-on" markerWidth="10" markerHeight="10" refX="7" refY="5" orient="auto">
              <path d="M0 0L8 5L0 10Z" fill="var(--accent)" />
            </marker>
            <marker id="df-arrow-rej" markerWidth="10" markerHeight="10" refX="7" refY="5" orient="auto">
              <path d="M0 0L8 5L0 10Z" fill="var(--warn)" />
            </marker>
          </defs>

          {edges.map((e) => {
            if (wiring?.detach && sameEdge(e, wiring.detach)) return null;
            const src = nodeById.get(e.from), dst = nodeById.get(e.to);
            if (!src || !dst) return null;
            const a = outAnchor(src, e.fromPort);
            const b = inAnchor(dst, e.port);
            const d = bezierPath(a, b);
            const mid = bezierMid(a, b);
            const key = `${edgeKey(e)}-${e.fromPort || 'out'}`;
            const isSel = sameEdge(selectedEdge, e);
            const isHover = hoverEdge === key;
            const touchesSel = selectedSet.has(e.from) || selectedSet.has(e.to);
            const rejected = (e.fromPort || 'out') === 'rejected';
            const emphasised = isSel || isHover || touchesSel;
            const stroke = e.crossDb ? 'url(#df-grad-cross)'
              : rejected ? 'var(--warn)'
              : emphasised ? 'var(--accent)' : 'var(--border-strong)';
            const marker = rejected ? 'url(#df-arrow-rej)' : emphasised ? 'url(#df-arrow-on)' : 'url(#df-arrow)';
            const rows = edgeCounters[edgeKey(e)];
            const rowLabel = rows != null ? Number(rows).toLocaleString() : null;
            const labelW = rowLabel ? Math.max(40, rowLabel.length * 7 + 16) : 0;
            return (
              <g key={key} className={cx('df-edge', isSel && 'is-selected', isHover && 'is-hover')}>
                <path d={d} className="df-edge-hit" stroke="transparent" strokeWidth={14} fill="none"
                      onMouseEnter={() => setHoverEdge(key)}
                      onMouseLeave={() => setHoverEdge(h => (h === key ? null : h))}
                      onMouseDown={(ev) => {
                        if (ev.button !== 0) return;
                        ev.stopPropagation();
                        useDataFlowStore.getState().selectEdge({ from: e.from, to: e.to, fromPort: e.fromPort || 'out' });
                      }} />
                <path d={d} className="df-edge-path" stroke={stroke}
                      strokeWidth={isSel ? 2.6 : emphasised ? 2.2 : 1.6} fill="none"
                      markerEnd={marker} opacity={emphasised ? 1 : 0.85}
                      strokeDasharray={rejected ? '6 4' : undefined} />

                <circle className="df-edge-handle" cx={a.x} cy={a.y} r={7} fill="transparent"
                  onMouseDown={(ev) => handleEdgeStartGrab(e, ev)} />
                <circle className="df-edge-handle" cx={b.x} cy={b.y} r={7} fill="transparent"
                  onMouseDown={(ev) => handleEdgeEndGrab(e, ev)} />

                {(rowLabel || rejected) && (
                  <g transform={`translate(${mid.x}, ${mid.y - 20})`} className="df-edge-labels">
                    {rowLabel && (
                      <g transform={`translate(${-(labelW + (rejected ? 58 : 0)) / 2}, 0)`}>
                        <rect width={labelW} height="18" rx="9" fill="var(--bg-2)" stroke="var(--border)" />
                        <text x={labelW / 2} y="12.5" textAnchor="middle" className="df-edge-label">{rowLabel}</text>
                      </g>
                    )}
                    {rejected && (
                      <g transform={`translate(${rowLabel ? (labelW - 58) / 2 + 4 : -27}, 0)`}>
                        <rect width="54" height="18" rx="9" className="df-edge-tag-rejected-bg" />
                        <text x="27" y="12.5" textAnchor="middle" className="df-edge-tag-rejected">rejected</text>
                      </g>
                    )}
                  </g>
                )}
                {e.crossDb && (
                  <g transform={`translate(${mid.x - 8}, ${mid.y + 6})`} className="df-edge-crossdb">
                    <title>Crosses databases</title>
                    <circle r="8" cx="8" cy="8" fill="var(--bg-2)" stroke="var(--accent)" />
                    <g transform="translate(2 2)">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                        <rect x="4" y="11" width="16" height="10" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                    </g>
                  </g>
                )}
                {isSel && (
                  <g className="df-edge-delete" transform={`translate(${mid.x}, ${mid.y})`}
                     role="button" aria-label="Delete connection" tabIndex={-1}
                     onMouseDown={(ev) => ev.stopPropagation()}
                     onClick={(ev) => { ev.stopPropagation(); useDataFlowStore.getState().removeEdge(e.from, e.to, e.fromPort || 'out'); }}>
                    <title>Delete connection</title>
                    <circle r="9" fill="var(--bg-2)" stroke="var(--err)" />
                    <path d="M-3.5 -3.5 L3.5 3.5 M3.5 -3.5 L-3.5 3.5" stroke="var(--err)" strokeWidth="1.6" strokeLinecap="round" />
                  </g>
                )}
              </g>
            );
          })}

          {wiringPath && (
            <path d={wiringPath} stroke="var(--accent)" strokeWidth={2} fill="none" strokeDasharray="6 4" opacity={0.75} />
          )}
        </svg>

        {nodes.map(n => (
          <DFNode
            key={n.id}
            node={n}
            selected={selectedSet.has(n.id)}
            multi={selectedSet.size > 1 && selectedSet.has(n.id)}
            issueLevel={issueByNode[n.id] || null}
            onMouseDown={handleNodeMouseDown}
            onMouseUp={handleNodeMouseUp}
            onPortMouseDown={handlePortMouseDown}
            onPortMouseUp={handlePortMouseUp}
          />
        ))}

        {marquee && (
          <div className="df-marquee" style={{
            left: Math.min(marquee.x1, marquee.x2), top: Math.min(marquee.y1, marquee.y2),
            width: Math.abs(marquee.x2 - marquee.x1), height: Math.abs(marquee.y2 - marquee.y1),
          }} />
        )}
      </div>

      {nodes.length === 0 && (
        <div className="df-canvas-empty">
          <Icon name="plus" size={32} style={{ opacity: 0.3 }} />
          <div className="df-canvas-empty-title">Drag nodes from the library to get started</div>
          <div className="df-canvas-empty-hint">
            Connect nodes by dragging from an output port to an input port.<br />
            Scroll to pan, <kbd>⌘</kbd>+scroll to zoom, <kbd>⇧</kbd>+drag to select.
          </div>
        </div>
      )}

      <div className="df-canvas-controls">
        <button className="df-zoom-btn" onClick={zoomOut} aria-label="Zoom out" title="Zoom out"><Icon name="minus" size={11} /></button>
        <span className="mono small df-zoom-pct" aria-live="polite">{Math.round(view.zoom * 100)}%</span>
        <button className="df-zoom-btn" onClick={zoomIn} aria-label="Zoom in" title="Zoom in"><Icon name="plus" size={11} /></button>
        <div className="df-zoom-sep"></div>
        <button className="df-zoom-btn" onClick={fit} aria-label="Fit to view" title="Fit to view"><Icon name="maximize" size={11} /></button>
      </div>

      <div className="df-canvas-mini">
        <DFMinimap nodes={nodes} edges={edges} selectedIds={selectedNodeIds} view={view} size={size} onCenter={centerOn} />
      </div>
    </div>
  );
}

import { useState, useRef, useCallback, useEffect } from 'react';
import { Icon } from '../icons/Icon';
import { DFNode, NODE_W, NODE_H } from './DFNode';
import { DFMinimap } from './DFMinimap';
import { DF_NODE_BY_KIND } from './catalog';
import { useDataFlowStore } from '../../stores/dataflow';

function clientToPipeline(innerEl, zoom, clientX, clientY) {
  const r = innerEl.getBoundingClientRect();
  return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom };
}

export function DFCanvas({ pipeline, selected, onSelect, onAddNode, onMoveNode, onAddEdge, onRemoveNode, onRemoveEdge }) {
  const edgeCounters = useDataFlowStore((s) => s.edgeCounters);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [wiring, setWiring] = useState(null);
  const canvasRef = useRef(null);
  const innerRef = useRef(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const nodeRect = (id) => {
    const n = pipeline.nodes.find(x => x.id === id);
    if (!n) return { x: 0, y: 0, w: NODE_W, h: NODE_H };
    return { x: n.x, y: n.y, w: NODE_W, h: NODE_H };
  };
  const outAnchor = (id) => {
    const r = nodeRect(id);
    return { x: r.x + r.w, y: r.y + r.h / 2 };
  };
  const inAnchor = (id, port) => {
    const r = nodeRect(id);
    if (port === 'L') return { x: r.x, y: r.y + r.h * 0.35 };
    if (port === 'R') return { x: r.x, y: r.y + r.h * 0.65 };
    return { x: r.x, y: r.y + r.h / 2 };
  };

  const startPan = (e) => {
    if (e.target.closest('.df-node')) return;
    if (e.button !== 0) return;
    onSelect(null);
    const start = { ...pan };
    const origin = { x: e.clientX, y: e.clientY };
    const move = (ev) => setPan({ x: start.x + (ev.clientX - origin.x), y: start.y + (ev.clientY - origin.y) });
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('text/plain');
    if (!kind || !DF_NODE_BY_KIND[kind]) return;
    const pt = clientToPipeline(innerRef.current, zoomRef.current, e.clientX, e.clientY);
    onAddNode?.({ kind, x: Math.round(pt.x), y: Math.round(pt.y) });
  }, [onAddNode]);

  // Start a wiring drag — direction is 'forward' (from output) or 'reverse' (from input)
  const startWiring = useCallback((anchorX, anchorY, fixedNodeId, direction, e) => {
    const pt = clientToPipeline(innerRef.current, zoomRef.current, e.clientX, e.clientY);
    setWiring({
      fixedId: fixedNodeId,
      direction,
      startX: anchorX,
      startY: anchorY,
      mouseX: pt.x,
      mouseY: pt.y,
    });
    const move = (ev) => {
      const mp = clientToPipeline(innerRef.current, zoomRef.current, ev.clientX, ev.clientY);
      setWiring(w => w ? { ...w, mouseX: mp.x, mouseY: mp.y } : null);
    };
    const up = () => {
      setWiring(null);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, []);

  // Port drag from a node's output port — forward wiring
  const handlePortDragStart = useCallback((nodeId, port, e) => {
    const anchor = outAnchor(nodeId);
    startWiring(anchor.x, anchor.y, nodeId, 'forward', e);
  }, [startWiring]);

  // Mouseup on input port — completes forward wiring
  const handlePortDragEnd = useCallback((targetId) => {
    if (wiring && wiring.direction === 'forward' && wiring.fixedId !== targetId) {
      const exists = pipeline.edges.some(e => e.from === wiring.fixedId && e.to === targetId);
      if (!exists) {
        onAddEdge?.({ from: wiring.fixedId, to: targetId, port: null, crossDb: false, rows: 0 });
      }
    }
    setWiring(null);
  }, [wiring, pipeline.edges, onAddEdge]);

  // Mouseup on output port — completes reverse wiring
  const handlePortDragEndReverse = useCallback((sourceId) => {
    if (wiring && wiring.direction === 'reverse' && wiring.fixedId !== sourceId) {
      const exists = pipeline.edges.some(e => e.from === sourceId && e.to === wiring.fixedId);
      if (!exists) {
        onAddEdge?.({ from: sourceId, to: wiring.fixedId, port: null, crossDb: false, rows: 0 });
      }
    }
    setWiring(null);
  }, [wiring, pipeline.edges, onAddEdge]);

  // Grab the end of an existing edge (near target) — detach and rewire from source
  const handleEdgeEndGrab = useCallback((edge, e) => {
    e.stopPropagation();
    onRemoveEdge?.(edge.from, edge.to);
    const anchor = outAnchor(edge.from);
    startWiring(anchor.x, anchor.y, edge.from, 'forward', e);
  }, [onRemoveEdge, startWiring]);

  // Grab the start of an existing edge (near source) — detach and rewire to target
  const handleEdgeStartGrab = useCallback((edge, e) => {
    e.stopPropagation();
    onRemoveEdge?.(edge.from, edge.to);
    const anchor = inAnchor(edge.to, edge.port);
    startWiring(anchor.x, anchor.y, edge.to, 'reverse', e);
  }, [onRemoveEdge, startWiring]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if (selected) {
          onRemoveNode?.(selected);
        }
      }
      if (e.key === 'Escape') {
        onSelect(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected, onRemoveNode, onSelect]);

  const safeNodes = pipeline.nodes.length > 0 ? pipeline.nodes : [{ x: 0, y: 0 }];
  const maxX = Math.max(...safeNodes.map(n => n.x)) + NODE_W + 400;
  const maxY = Math.max(...safeNodes.map(n => n.y)) + NODE_H + 400;

  // Bezier path for the wiring temp line — direction determines curvature
  const wiringPath = wiring && (() => {
    let x1, y1, x2, y2;
    if (wiring.direction === 'forward') {
      x1 = wiring.startX; y1 = wiring.startY;
      x2 = wiring.mouseX; y2 = wiring.mouseY;
    } else {
      x1 = wiring.mouseX; y1 = wiring.mouseY;
      x2 = wiring.startX; y2 = wiring.startY;
    }
    const dx = Math.max(60, (x2 - x1) * 0.45);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  })();

  return (
    <div className="df-canvas" onMouseDown={startPan} onDragOver={handleDragOver} onDrop={handleDrop} ref={canvasRef}>
      <div
        ref={innerRef}
        className="df-canvas-inner"
        style={{
          width: maxX, height: maxY,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <svg className="df-edges" width={maxX} height={maxY}>
          <defs>
            <pattern id="df-grid-dot" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="var(--border)" />
            </pattern>
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
          </defs>
          <rect width="100%" height="100%" fill="url(#df-grid-dot)" />

          {pipeline.edges.map((e, i) => {
            const a = outAnchor(e.from);
            const b = inAnchor(e.to, e.port);
            const dx = Math.max(60, (b.x - a.x) * 0.45);
            const d = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
            const highlight = e.from === selected || e.to === selected;
            const stroke = e.crossDb ? 'url(#df-grad-cross)' : (highlight ? 'var(--accent)' : 'var(--border-strong)');
            return (
              <g key={i}>
                <path d={d} stroke="transparent" strokeWidth={12} fill="none" style={{ cursor: 'pointer' }}
                      onClick={() => onRemoveEdge?.(e.from, e.to)} />
                <path d={d} stroke={stroke} strokeWidth={highlight ? 2.2 : 1.6} fill="none"
                      markerEnd={highlight ? 'url(#df-arrow-on)' : 'url(#df-arrow)'}
                      opacity={highlight ? 1 : 0.85} style={{ pointerEvents: 'none' }} />

                {/* Draggable endpoint handles — source end */}
                <circle cx={a.x} cy={a.y} r={7}
                  fill="transparent" stroke="none"
                  style={{ cursor: 'grab', pointerEvents: 'all' }}
                  onMouseDown={(ev) => handleEdgeStartGrab(e, ev)} />
                {/* Draggable endpoint handles — target end */}
                <circle cx={b.x} cy={b.y} r={7}
                  fill="transparent" stroke="none"
                  style={{ cursor: 'grab', pointerEvents: 'all' }}
                  onMouseDown={(ev) => handleEdgeEndGrab(e, ev)} />

                {(edgeCounters[`${e.from}-${e.to}`] || e.rows) > 0 && (
                  <g transform={`translate(${(a.x + b.x) / 2 - 26}, ${(a.y + b.y) / 2 - 9})`}>
                    <rect width="52" height="18" rx="9" fill="var(--bg-2)" stroke="var(--border)" />
                    <text x="26" y="12" textAnchor="middle" className="df-edge-label">{(edgeCounters[`${e.from}-${e.to}`] || e.rows).toLocaleString()}</text>
                  </g>
                )}
                {e.crossDb && (
                  <g transform={`translate(${(a.x + b.x) / 2 - 7}, ${(a.y + b.y) / 2 + 12})`}>
                    <circle r="8" cx="8" cy="8" fill="var(--bg-2)" stroke="var(--accent)" />
                    <g transform="translate(2 2)">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                        <rect x="4" y="11" width="16" height="10" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                    </g>
                  </g>
                )}
              </g>
            );
          })}

          {wiringPath && (
            <path d={wiringPath} stroke="var(--accent)" strokeWidth={2} fill="none" strokeDasharray="6 4" opacity={0.7} />
          )}
        </svg>

        {pipeline.nodes.map(n => (
          <DFNode
            key={n.id}
            node={n}
            selected={selected === n.id}
            onSelect={onSelect}
            onMove={onMoveNode}
            onPortDragStart={handlePortDragStart}
            onPortDragEnd={handlePortDragEnd}
            onPortDragEndReverse={handlePortDragEndReverse}
          />
        ))}

        {pipeline.nodes.length === 0 && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            textAlign: 'center', color: 'var(--text-3)', fontSize: '1em',
          }}>
            <Icon name="plus" size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div>Drag nodes from the library to get started</div>
          </div>
        )}
      </div>

      <div className="df-canvas-controls">
        <button className="df-zoom-btn" onClick={() => setZoom(z => Math.max(0.4, z - 0.1))}><Icon name="minus" size={11} /></button>
        <span className="mono small">{Math.round(zoom * 100)}%</span>
        <button className="df-zoom-btn" onClick={() => setZoom(z => Math.min(1.5, z + 0.1))}><Icon name="plus" size={11} /></button>
        <div className="df-zoom-sep"></div>
        <button className="df-zoom-btn" title="Fit to view" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><Icon name="maximize" size={11} /></button>
      </div>

      <div className="df-canvas-mini">
        <DFMinimap pipeline={pipeline} selected={selected} />
      </div>
    </div>
  );
}

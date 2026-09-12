import { DF_NODE_BY_KIND } from './catalog';
import { NODE_W, NODE_H, nodesBounds } from './graphUtils';

const W = 180, H = 90, PAD = 6;

/**
 * Minimap of the pipeline plus the current viewport rectangle.
 * `view` = {x, y, zoom} (canvas pan/zoom), `size` = {w, h} of the canvas
 * element. Clicking centres the canvas on the clicked pipeline point.
 */
export function DFMinimap({ nodes, edges, selectedIds, view, size, onCenter }) {
  const selected = new Set(selectedIds || []);
  const zoom = view?.zoom || 1;
  // Viewport rectangle in pipeline coordinates.
  const vp = size && size.w > 0 && size.h > 0
    ? { x: -(view?.x || 0) / zoom, y: -(view?.y || 0) / zoom, w: size.w / zoom, h: size.h / zoom }
    : null;

  const nb = nodesBounds(nodes);
  let minX, minY, maxX, maxY;
  if (nb && vp) {
    minX = Math.min(nb.minX, vp.x); minY = Math.min(nb.minY, vp.y);
    maxX = Math.max(nb.maxX, vp.x + vp.w); maxY = Math.max(nb.maxY, vp.y + vp.h);
  } else if (nb) {
    ({ minX, minY, maxX, maxY } = nb);
  } else if (vp) {
    minX = vp.x; minY = vp.y; maxX = vp.x + vp.w; maxY = vp.y + vp.h;
  } else {
    return <svg width={W} height={H} aria-hidden="true" />;
  }
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
  const scale = Math.min((W - PAD * 2) / bw, (H - PAD * 2) / bh);
  if (!Number.isFinite(scale) || scale <= 0) return <svg width={W} height={H} aria-hidden="true" />;
  // Centre the drawing inside the minimap.
  const ox = PAD + ((W - PAD * 2) - bw * scale) / 2;
  const oy = PAD + ((H - PAD * 2) - bh * scale) / 2;
  const tx = (x) => ox + (x - minX) * scale;
  const ty = (y) => oy + (y - minY) * scale;

  const handleClick = (e) => {
    if (!onCenter) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = minX + (e.clientX - r.left - ox) / scale;
    const py = minY + (e.clientY - r.top - oy) / scale;
    onCenter(px, py);
  };

  return (
    <svg width={W} height={H} className="df-minimap" onClick={handleClick} role="img" aria-label="Pipeline minimap">
      {(edges || []).map((e, i) => {
        const a = nodes.find(n => n.id === e.from);
        const b = nodes.find(n => n.id === e.to);
        if (!a || !b) return null;
        return (
          <line key={i}
            x1={tx(a.x + NODE_W)} y1={ty(a.y + NODE_H / 2)}
            x2={tx(b.x)} y2={ty(b.y + NODE_H / 2)}
            stroke="var(--border-strong)" strokeWidth="0.8" />
        );
      })}
      {(nodes || []).map(n => {
        const def = DF_NODE_BY_KIND[n.kind];
        const sel = selected.has(n.id);
        return (
          <rect key={n.id}
            x={tx(n.x)} y={ty(n.y)}
            width={Math.max(2, NODE_W * scale)} height={Math.max(2, NODE_H * scale)} rx="1.5"
            fill={sel ? 'var(--accent)' : `var(--df-${def?.family || 'code'})`}
            opacity={sel ? 1 : 0.55} />
        );
      })}
      {vp && (
        <rect className="df-minimap-vp"
          x={tx(vp.x)} y={ty(vp.y)} width={vp.w * scale} height={vp.h * scale}
          fill="color-mix(in oklab, var(--accent) 8%, transparent)"
          stroke="var(--accent)" strokeWidth="1" rx="1" />
      )}
    </svg>
  );
}

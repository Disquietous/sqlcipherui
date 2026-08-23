import { DF_NODE_BY_KIND } from './catalog';
import { NODE_W, NODE_H } from './DFNode';

export function DFMinimap({ pipeline, selected }) {
  const xs = pipeline.nodes.map(n => n.x);
  const ys = pipeline.nodes.map(n => n.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const maxX = Math.max(...xs) + NODE_W, maxY = Math.max(...ys) + NODE_H;
  const w = maxX - minX, h = maxY - minY;
  const W = 180, H = 90;
  const scale = Math.min(W / w, H / h);

  return (
    <svg width={W} height={H}>
      {pipeline.edges.map((e, i) => {
        const a = pipeline.nodes.find(n => n.id === e.from);
        const b = pipeline.nodes.find(n => n.id === e.to);
        if (!a || !b) return null;
        return (
          <line key={i}
            x1={(a.x - minX + NODE_W) * scale} y1={(a.y - minY + NODE_H / 2) * scale}
            x2={(b.x - minX) * scale} y2={(b.y - minY + NODE_H / 2) * scale}
            stroke="var(--border-strong)" strokeWidth="0.8" />
        );
      })}
      {pipeline.nodes.map(n => {
        const def = DF_NODE_BY_KIND[n.kind];
        const sel = n.id === selected;
        return (
          <rect key={n.id}
            x={(n.x - minX) * scale} y={(n.y - minY) * scale}
            width={NODE_W * scale} height={NODE_H * scale} rx="2"
            fill={sel ? 'var(--accent)' : `var(--df-${def.family})`}
            opacity={sel ? 1 : 0.55} />
        );
      })}
    </svg>
  );
}

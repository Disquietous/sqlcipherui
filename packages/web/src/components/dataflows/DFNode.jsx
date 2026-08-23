import { useCallback } from 'react';
import { Icon } from '../icons/Icon';
import { DF_NODE_BY_KIND } from './catalog';
import { useDataFlowStore } from '../../stores/dataflow';

const cx = (...xs) => xs.filter(Boolean).join(' ');

export const NODE_W = 220;
export const NODE_H = 76;

export function DFNode({ node, selected, onSelect, onMove, onPortDragStart, onPortDragEnd, onPortDragEndReverse }) {
  const def = DF_NODE_BY_KIND[node.kind];
  const liveCounter = useDataFlowStore((s) => s.nodeCounters[node.id]);
  const inRows = liveCounter?.inRows ?? node.inRows;
  const outRows = liveCounter?.outRows ?? node.out;
  if (!def) return null;

  const startDrag = useCallback((e) => {
    if (e.target.closest('.df-node-port')) return;
    e.stopPropagation();
    onSelect(node.id);
    const startX = e.clientX, startY = e.clientY;
    const origX = node.x, origY = node.y;
    const move = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      onMove?.(node.id, origX + dx, origY + dy);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [node.id, node.x, node.y, onSelect, onMove]);

  const handlePortOut = useCallback((e) => {
    e.stopPropagation();
    onPortDragStart?.(node.id, 'out', e);
  }, [node.id, onPortDragStart]);

  const handlePortIn = useCallback((e) => {
    e.stopPropagation();
    onPortDragEnd?.(node.id, e);
  }, [node.id, onPortDragEnd]);

  const handlePortOutUp = useCallback((e) => {
    e.stopPropagation();
    onPortDragEndReverse?.(node.id);
  }, [node.id, onPortDragEndReverse]);

  return (
    <div
      className={cx('df-node', `family-${def.family}`, selected && 'is-selected', node.warn && 'has-warn')}
      style={{ left: node.x, top: node.y, width: NODE_W }}
      onMouseDown={startDrag}
    >
      <div className="df-node-head">
        <span className={cx('df-node-ic', `family-${def.family}`)}>
          <Icon name={def.icon} size={11} />
        </span>
        <span className="df-node-name">{def.name}</span>
        {node.encrypted && <span className="df-node-lock" title="Encrypted DB"><Icon name="lock" size={10} /></span>}
        {node.warn && <span className="df-node-warn" title="Has warnings"><Icon name="alert" size={10} /></span>}
      </div>
      <div className="df-node-body">
        <span className="df-node-summary mono">{node.summary}</span>
      </div>
      <span className="df-node-port df-node-port-in" onMouseUp={handlePortIn}></span>
      <span className="df-node-port df-node-port-out" onMouseDown={handlePortOut} onMouseUp={handlePortOutUp}></span>
      {inRows != null && (
        <span className="df-node-rows in" title="rows in">{inRows.toLocaleString()}</span>
      )}
      {outRows != null && (
        <span className="df-node-rows out" title="rows out">{outRows.toLocaleString()}</span>
      )}
    </div>
  );
}

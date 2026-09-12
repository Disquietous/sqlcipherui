import { useCallback } from 'react';
import { Icon } from '../icons/Icon';
import { DF_NODE_BY_KIND, nodeInputs, nodeOutputs } from './catalog';
import { useDataFlowStore } from '../../stores/dataflow';
import { NODE_W, NODE_H, MULTI_INPUT_KINDS, portFraction } from './graphUtils';

export { NODE_W, NODE_H };

const cx = (...xs) => xs.filter(Boolean).join(' ');

/**
 * A single canvas node. Position/drag/selection are owned by DFCanvas; this
 * component only reports pointer events on its body and ports.
 *
 * Props:
 *   node, selected, multi (part of a multi-selection), issueLevel ('error'|'warn'|null)
 *   onMouseDown(nodeId, e)        body press (drag / select)
 *   onMouseUp(nodeId, e)          body release (completes a wiring drop)
 *   onPortMouseDown(nodeId, side, port, e)
 *   onPortMouseUp(nodeId, side, port, e)   side is 'in' | 'out'
 */
export function DFNode({ node, selected, multi, issueLevel, onMouseDown, onMouseUp, onPortMouseDown, onPortMouseUp }) {
  const counter = useDataFlowStore((s) => s.nodeCounters[node.id]);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.df-node-port')) return;
    e.stopPropagation();
    onMouseDown?.(node.id, e);
  }, [node.id, onMouseDown]);

  const handleMouseUp = useCallback((e) => {
    if (e.target.closest('.df-node-port')) return;
    onMouseUp?.(node.id, e);
  }, [node.id, onMouseUp]);

  const def = DF_NODE_BY_KIND[node.kind];
  if (!def) return null;

  const inputs = nodeInputs(node.kind);
  const outputs = nodeOutputs(node.kind);
  const isSource = def.family === 'source';
  const isSink = def.family === 'sink';
  const multiIn = MULTI_INPUT_KINDS.has(node.kind);
  const inRows = counter?.inRows;
  const outRows = counter?.outRows;

  return (
    <div
      className={cx(
        'df-node', `family-${def.family}`,
        selected && 'is-selected',
        multi && 'is-multi',
        issueLevel && `has-${issueLevel}`,
        def.status === 'soon' && 'is-soon',
      )}
      style={{ left: node.x, top: node.y, width: NODE_W, minHeight: NODE_H }}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      tabIndex={0}
      role="button"
      aria-pressed={!!selected}
      aria-label={`${def.name} node ${node.summary || node.id}`}
      data-node-id={node.id}
    >
      <div className="df-node-head">
        <span className={cx('df-node-ic', `family-${def.family}`)}>
          <Icon name={def.icon} size={11} />
        </span>
        <span className="df-node-name">{def.name}</span>
        {def.status === 'soon' && <span className="df-node-soon" title="Not available yet">soon</span>}
        {node.config?.key && <span className="df-node-lock" title="Uses an encryption key"><Icon name="lock" size={10} /></span>}
        {issueLevel && (
          <span className={cx('df-node-issue-dot', `is-${issueLevel}`)}
                title={issueLevel === 'error' ? 'Has errors' : 'Has warnings'}
                aria-label={issueLevel === 'error' ? 'Has errors' : 'Has warnings'} />
        )}
      </div>
      <div className="df-node-body">
        <span className="df-node-summary mono">{node.summary || <span className="df-node-summary-empty">Not configured</span>}</span>
      </div>

      {!isSource && inputs.map((p, i) => (
        <span
          key={`in-${p}`}
          className={cx('df-node-port', 'df-node-port-in', multiIn && 'is-multi', inputs.length > 1 && 'is-named')}
          style={{ top: `${portFraction(i, inputs.length) * 100}%` }}
          data-port={p}
          title={inputs.length > 1 ? `Input ${p}` : (multiIn ? 'Inputs (any number)' : 'Input')}
          onMouseDown={(e) => { e.stopPropagation(); onPortMouseDown?.(node.id, 'in', p, e); }}
          onMouseUp={(e) => onPortMouseUp?.(node.id, 'in', p, e)}
        >
          {inputs.length > 1 && <span className="df-node-port-label in">{p}</span>}
        </span>
      ))}

      {!isSink && outputs.map((p, i) => (
        <span
          key={`out-${p}`}
          className={cx('df-node-port', 'df-node-port-out', p === 'rejected' && 'port-rejected', outputs.length > 1 && 'is-named')}
          style={{ top: `${portFraction(i, outputs.length) * 100}%` }}
          data-port={p}
          title={outputs.length > 1 ? `Output ${p}` : 'Output'}
          onMouseDown={(e) => { e.stopPropagation(); onPortMouseDown?.(node.id, 'out', p, e); }}
          onMouseUp={(e) => onPortMouseUp?.(node.id, 'out', p, e)}
        >
          {outputs.length > 1 && <span className="df-node-port-label out">{p}</span>}
        </span>
      ))}

      {inRows != null && !isSource && (
        <span className="df-node-rows in" title="rows in">{Number(inRows).toLocaleString()}</span>
      )}
      {outRows != null && (
        <span className="df-node-rows out" title="rows out">{Number(outRows).toLocaleString()}</span>
      )}
    </div>
  );
}

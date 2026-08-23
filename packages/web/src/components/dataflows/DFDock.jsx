import { useCallback, useRef } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { DFDockPreview } from './DFDockPreview';
import { DFDockLog } from './DFDockLog';
import { DFDockIssues } from './DFDockIssues';
import { DFDockHistory } from './DFDockHistory';

const cx = (...xs) => xs.filter(Boolean).join(' ');

export function DFDock({ tab, setTab, height, pipeline, selectedNode }) {
  const setDockHeight = useDataFlowStore((s) => s.setDockHeight);
  const handleRef = useRef(null);

  const startResize = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const move = (ev) => setDockHeight(startH - (ev.clientY - startY));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [height, setDockHeight]);

  return (
    <div className="df-dock" style={{ height }}>
      <div className="df-dock-resize" onMouseDown={startResize}></div>
      <div className="df-dock-bar">
        <div className="df-dock-tabs">
          <button className={cx('df-dock-tab', tab === 'preview' && 'is-active')} onClick={() => setTab('preview')}>
            <Icon name="eye" size={11} /><span>Preview</span>
            {selectedNode && <span className="df-dock-tab-meta">@ {selectedNode.id}</span>}
          </button>
          <button className={cx('df-dock-tab', tab === 'log' && 'is-active')} onClick={() => setTab('log')}>
            <Icon name="terminal" size={11} /><span>Run log</span>
          </button>
          <button className={cx('df-dock-tab', tab === 'issues' && 'is-active')} onClick={() => setTab('issues')}>
            <Icon name="alert" size={11} /><span>Issues</span>
          </button>
          <button className={cx('df-dock-tab', tab === 'history' && 'is-active')} onClick={() => setTab('history')}>
            <Icon name="history" size={11} /><span>Run history</span>
          </button>
        </div>
        <div style={{ flex: 1 }}></div>
        <div className="df-dock-actions">
          <button className="iconbtn-sm" title="Minimize" onClick={() => setDockHeight(height <= 100 ? 260 : 40)}>
            <Icon name={height <= 100 ? 'chevron-up' : 'chevron-down'} size={11} />
          </button>
        </div>
      </div>
      <div className="df-dock-body">
        {tab === 'preview' && <DFDockPreview node={selectedNode} />}
        {tab === 'log' && <DFDockLog />}
        {tab === 'issues' && <DFDockIssues />}
        {tab === 'history' && <DFDockHistory />}
      </div>
    </div>
  );
}

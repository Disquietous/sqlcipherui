import { useCallback } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { DFDockPreview } from './DFDockPreview';
import { DFDockLog } from './DFDockLog';
import { DFDockIssues } from './DFDockIssues';
import { DFDockHistory } from './DFDockHistory';

const cx = (...xs) => xs.filter(Boolean).join(' ');
const COLLAPSED_H = 40;
const DEFAULT_H = 260;

export function DFDock({ tab, setTab, height, selectedNode }) {
  const setDockHeight = useDataFlowStore((s) => s.setDockHeight);
  const issueCount = useDataFlowStore((s) => s.validationIssues.length);
  const isRunning = useDataFlowStore((s) => s.isRunning);
  const collapsed = height <= COLLAPSED_H;

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

  const pick = (id) => {
    setTab(id);
    if (collapsed) setDockHeight(DEFAULT_H);
  };

  const tabs = [
    { id: 'preview', icon: 'eye', label: 'Preview', meta: selectedNode ? `@ ${selectedNode.id}` : null },
    { id: 'log', icon: 'terminal', label: 'Run log', live: isRunning },
    { id: 'issues', icon: 'alert', label: 'Issues', count: issueCount },
    { id: 'history', icon: 'history', label: 'Run history' },
  ];

  return (
    <div className={cx('df-dock', collapsed && 'is-collapsed')} style={{ height }}>
      <div className="df-dock-resize" onMouseDown={startResize} role="separator" aria-orientation="horizontal" aria-label="Resize dock"></div>
      <div className="df-dock-bar">
        <div className="df-dock-tabs" role="tablist">
          {tabs.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id}
                    className={cx('df-dock-tab', tab === t.id && 'is-active')} onClick={() => pick(t.id)}>
              <Icon name={t.icon} size={11} /><span>{t.label}</span>
              {t.meta && <span className="df-dock-tab-meta">{t.meta}</span>}
              {t.count > 0 && <span className="df-dock-tab-count">{t.count}</span>}
              {t.live && <span className="df-dock-tab-live" aria-label="Run in progress" />}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }}></div>
        <div className="df-dock-actions">
          <button className="iconbtn-sm"
                  aria-label={collapsed ? 'Expand dock' : 'Minimize dock'}
                  title={collapsed ? 'Expand' : 'Minimize'}
                  onClick={() => setDockHeight(collapsed ? DEFAULT_H : COLLAPSED_H)}>
            <Icon name={collapsed ? 'chevron-up' : 'chevron-down'} size={11} />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="df-dock-body" role="tabpanel">
          {tab === 'preview' && <DFDockPreview node={selectedNode} />}
          {tab === 'log' && <DFDockLog />}
          {tab === 'issues' && <DFDockIssues />}
          {tab === 'history' && <DFDockHistory />}
        </div>
      )}
    </div>
  );
}

import { useCallback } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { streamRun } from '../../api/dataflow';

const cx = (...xs) => xs.filter(Boolean).join(' ');

function DFRunBar() {
  const runMode = useDataFlowStore((s) => s.runMode);
  const setRunMode = useDataFlowStore((s) => s.setRunMode);
  const transactional = useDataFlowStore((s) => s.transactional);
  const setTransactional = useDataFlowStore((s) => s.setTransactional);
  const streamingCounters = useDataFlowStore((s) => s.streamingCounters);
  const setStreamingCounters = useDataFlowStore((s) => s.setStreamingCounters);
  const isRunning = useDataFlowStore((s) => s.isRunning);
  const pipeline = useDataFlowStore((s) => s.pipeline);

  const handleRun = useCallback(() => {
    if (!pipeline?.id || isRunning) return;
    const store = useDataFlowStore.getState();
    store.setIsRunning(true);
    store.setDockTab('log');

    const startEvent = {
      type: 'info', level: 'info',
      message: `Starting ${runMode} run...`,
      timestamp: new Date().toISOString(),
    };
    store.appendRunEvent(startEvent);

    streamRun(
      pipeline.id,
      { mode: runMode, transactional, streaming_counters: streamingCounters },
      (event) => {
        const s = useDataFlowStore.getState();
        s.appendRunEvent(event);
        if (event.type === 'progress' && event.node_id) {
          s.updateNodeCounter(event.node_id, event.in_rows ?? 0, event.out_rows ?? 0);
        }
        if (event.type === 'edge_progress' && event.from && event.to) {
          s.updateEdgeCounter(event.from, event.to, event.rows ?? 0);
        }
      },
      () => {
        useDataFlowStore.getState().setIsRunning(false);
        useDataFlowStore.getState().appendRunEvent({
          type: 'info', level: 'info',
          message: 'Run complete.',
          timestamp: new Date().toISOString(),
        });
      },
    );
  }, [pipeline?.id, isRunning, runMode, transactional, streamingCounters]);

  return (
    <div className="df-runbar">
      <div className="df-runmode">
        <button className={cx('df-runmode-btn', runMode === 'preview' && 'is-on')} onClick={() => setRunMode('preview')}>Preview</button>
        <button className={cx('df-runmode-btn', runMode === 'dry' && 'is-on')} onClick={() => setRunMode('dry')}>Dry run</button>
        <button className={cx('df-runmode-btn', runMode === 'full' && 'is-on')} onClick={() => setRunMode('full')}>Full run</button>
      </div>
      <button className={cx('df-run-btn', isRunning && 'is-running')} onClick={handleRun} disabled={isRunning}>
        <Icon name={isRunning ? 'loader' : 'play'} size={11} />
        <span>{isRunning ? 'Running…' : 'Run'}</span>
        <kbd>{'⌘⏎'}</kbd>
      </button>
      <div className="df-runtoggles">
        <label className="df-toggle">
          <input type="checkbox" checked={transactional} onChange={(e) => setTransactional(e.target.checked)} />
          <span>Transactional</span>
        </label>
        <label className="df-toggle">
          <input type="checkbox" checked={streamingCounters} onChange={(e) => setStreamingCounters(e.target.checked)} />
          <span>Streaming counters</span>
        </label>
      </div>
    </div>
  );
}

export function DFTopBar() {
  const view = useDataFlowStore((s) => s.view);
  const pipeline = useDataFlowStore((s) => s.pipeline);
  const pipelineDirty = useDataFlowStore((s) => s.pipelineDirty);
  const setView = useDataFlowStore((s) => s.setView);
  const setModal = useDataFlowStore((s) => s.setModal);
  const closePipeline = useDataFlowStore((s) => s.closePipeline);
  const toggleStar = useDataFlowStore((s) => s.toggleStar);
  const undoStack = useDataFlowStore((s) => s.undoStack);
  const redoStack = useDataFlowStore((s) => s.redoStack);
  const undo = useDataFlowStore((s) => s.undo);
  const redo = useDataFlowStore((s) => s.redo);

  return (
    <div className="df-top">
      <div className="df-top-left">
        <Icon name="shield" size={14} style={{ color: 'var(--accent)' }} />
        <span className="df-brand">Data Flows</span>
        <span className="df-crumb muted">/</span>
        {view === 'home' && <span className="df-crumb">All pipelines</span>}
        {view === 'guide' && (
          <>
            <button className="df-crumb-link" onClick={() => setView('home')}>All pipelines</button>
            <span className="df-crumb muted">/</span>
            <span className="df-crumb">Guide</span>
          </>
        )}
        {view === 'editor' && (
          <>
            <button className="df-crumb-link" onClick={closePipeline}>All pipelines</button>
            <span className="df-crumb muted">/</span>
            <span className="df-crumb mono">{pipeline?.name}</span>
            {pipelineDirty && <span className="df-dirty-dot" title="Unsaved changes"></span>}
            <button className="iconbtn-sm" onClick={toggleStar} title={pipeline?.starred ? 'Unstar' : 'Star'} style={{ marginLeft: 4, color: pipeline?.starred ? 'var(--warn)' : 'var(--text-3)' }}>
              <Icon name="star" size={11} />
            </button>
            <span style={{ marginLeft: 8, display: 'flex', gap: 2 }}>
              <button className="iconbtn-sm" onClick={undo} disabled={undoStack.length === 0} title="Undo (⌘Z)">
                <Icon name="chevron-left" size={11} />
              </button>
              <button className="iconbtn-sm" onClick={redo} disabled={redoStack.length === 0} title="Redo (⌘⇧Z)">
                <Icon name="chevron-right" size={11} />
              </button>
            </span>
          </>
        )}
      </div>
      <div className="df-top-center">
        {view === 'editor' && <DFRunBar />}
      </div>
      <div className="df-top-right">
        <button className="tb-btn" onClick={() => setView('guide')}>
          <Icon name="book" size={11} /><span>Guide</span>
        </button>
        <button className="tb-btn" onClick={() => setModal('connections')}>
          <Icon name="database" size={11} /><span>Connections</span>
        </button>
        <button className="tb-btn" onClick={() => setModal('templates')}>
          <Icon name="beaker" size={11} /><span>Templates</span>
        </button>
        <button className="tb-btn tb-primary" onClick={() => setModal('new')}>
          <Icon name="plus" size={11} /><span>New pipeline</span>
        </button>
      </div>
    </div>
  );
}

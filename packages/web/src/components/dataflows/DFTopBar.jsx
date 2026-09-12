import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { useRunController, getCanvasApi, fmtDuration, fmtRows } from './useRunController';

const cx = (...xs) => xs.filter(Boolean).join(' ');

const STATUS_LABEL = { ok: 'ok', partial: 'partial', failed: 'failed', cancelled: 'cancelled', running: 'running' };

export function RunStatusPill({ status, isRunning, title, className }) {
  const st = isRunning ? 'running' : status;
  if (!st) return null;
  return (
    <span className={cx('df-status-pill', `status-${st}`, className)} title={title} aria-live="polite">
      <span className="df-status-dot" aria-hidden="true" />
      {STATUS_LABEL[st] || st}
    </span>
  );
}

// ---- editable title -----------------------------------------------------------
function PipelineTitle({ pipeline }) {
  const updatePipelineMeta = useDataFlowStore((s) => s.updatePipelineMeta);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const start = () => { setDraft(pipeline?.name || ''); setEditing(true); };
  const commit = () => {
    const name = draft.trim();
    setEditing(false);
    if (name && name !== pipeline?.name) updatePipelineMeta({ name });
  };

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="df-title-input mono"
        value={draft}
        aria-label="Pipeline name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
        }}
      />
    );
  }
  return (
    <button className="df-title-btn mono" onClick={start} title="Rename pipeline" aria-label={`Rename pipeline ${pipeline?.name || ''}`}>
      {pipeline?.name || 'Untitled'}
    </button>
  );
}

// ---- schedule popover ----------------------------------------------------------
const CRON_HINT = 'minute hour day-of-month month day-of-week';

function cronError(expr) {
  const v = expr.trim();
  if (!v) return null;
  const fields = v.split(/\s+/);
  if (fields.length !== 5) return `Expected 5 fields (${CRON_HINT}), got ${fields.length}`;
  if (fields.some(f => !/^[\d*,\-/]+$/.test(f))) return 'Fields may contain digits, * , - and / only';
  return null;
}

function SchedulePopover({ pipeline, onClose }) {
  const updatePipelineMeta = useDataFlowStore((s) => s.updatePipelineMeta);
  const pushToast = useDataFlowStore((s) => s.pushToast);
  const { forceSave } = useRunController();
  const [expr, setExpr] = useState(pipeline?.schedule || '');
  const [enabled, setEnabled] = useState(!!pipeline?.schedule_enabled);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef(null);
  const err = cronError(expr);

  useEffect(() => {
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const save = async () => {
    if (err) return;
    const schedule = expr.trim();
    setSaving(true);
    updatePipelineMeta({ schedule, schedule_enabled: enabled && schedule ? 1 : 0 });
    const ok = await forceSave();
    setSaving(false);
    if (ok) {
      pushToast({ level: 'ok', message: schedule && enabled ? `Schedule saved: ${schedule}` : 'Schedule disabled' });
      onClose();
    }
  };

  return (
    <div className="df-popover df-sched-popover" ref={rootRef} role="dialog" aria-label="Schedule pipeline">
      <div className="df-popover-title">Schedule</div>
      <label className="df-field">
        <span className="df-field-label">Cron expression (UTC)</span>
        <input
          className={cx('df-input df-input-compact mono', err && 'is-invalid')}
          value={expr}
          placeholder="*/15 * * * *"
          spellCheck={false}
          aria-label="Cron expression"
          aria-invalid={!!err}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        />
        <span className={cx('df-field-hint small', err ? 'err' : 'muted')}>{err || CRON_HINT}</span>
      </label>
      <label className="df-toggle">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!expr.trim()} />
        <span>Enabled</span>
      </label>
      {pipeline?.last_scheduled_at && (
        <div className="muted small">Last scheduled run: <span className="mono">{pipeline.last_scheduled_at}</span></div>
      )}
      <div className="df-popover-actions">
        <button className="btn small" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary small" onClick={save} disabled={!!err || saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

// ---- run bar ----------------------------------------------------------------------
function DFRunBar() {
  const runMode = useDataFlowStore((s) => s.runMode);
  const setRunMode = useDataFlowStore((s) => s.setRunMode);
  const transactional = useDataFlowStore((s) => s.transactional);
  const setTransactional = useDataFlowStore((s) => s.setTransactional);
  const streamingCounters = useDataFlowStore((s) => s.streamingCounters);
  const setStreamingCounters = useDataFlowStore((s) => s.setStreamingCounters);
  const isRunning = useDataFlowStore((s) => s.isRunning);
  const runStatus = useDataFlowStore((s) => s.runStatus);
  const pipeline = useDataFlowStore((s) => s.pipeline);
  const { triggerRun, stopRun, runValidation } = useRunController();
  const [validating, setValidating] = useState(false);
  const [schedOpen, setSchedOpen] = useState(false);
  const closeSched = useCallback(() => setSchedOpen(false), []);

  const handleValidate = async () => {
    setValidating(true);
    await runValidation();
    useDataFlowStore.getState().setDockTab('issues');
    setValidating(false);
  };

  const statusTitle = runStatus
    ? [
      `Last run: ${runStatus.status}`,
      runStatus.total_rows != null && `${fmtRows(runStatus.total_rows)} rows`,
      runStatus.duration_ms != null && fmtDuration(runStatus.duration_ms),
      runStatus.error,
    ].filter(Boolean).join(' · ')
    : undefined;

  return (
    <div className="df-runbar">
      <div className="df-runmode" role="radiogroup" aria-label="Run mode">
        {[['preview', 'Preview'], ['dry', 'Dry run'], ['full', 'Full run']].map(([m, label]) => (
          <button key={m} role="radio" aria-checked={runMode === m}
                  className={cx('df-runmode-btn', runMode === m && 'is-on')}
                  onClick={() => setRunMode(m)} disabled={isRunning}>{label}</button>
        ))}
      </div>
      <button className={cx('df-run-btn', isRunning && 'is-running')} onClick={triggerRun} disabled={isRunning} title="Run pipeline (⌘⏎)">
        <Icon name={isRunning ? 'loader' : 'play'} size={11} style={isRunning ? { animation: 'df-spin 1s linear infinite' } : undefined} />
        <span>{isRunning ? 'Running…' : 'Run'}</span>
        {!isRunning && <kbd>{'⌘⏎'}</kbd>}
      </button>
      <button className="df-stop-btn" onClick={stopRun} disabled={!isRunning} aria-label="Stop run" title="Stop run">
        <Icon name="stop" size={11} />
      </button>
      <RunStatusPill status={runStatus?.status} isRunning={isRunning} title={statusTitle} />
      <div className="df-runtoggles">
        <label className="df-toggle" title="Wrap all table writes on a connection in one transaction">
          <input type="checkbox" checked={transactional} onChange={(e) => setTransactional(e.target.checked)} />
          <span>Transactional</span>
        </label>
        <label className="df-toggle" title="Show live row counters on nodes and edges">
          <input type="checkbox" checked={streamingCounters} onChange={(e) => setStreamingCounters(e.target.checked)} />
          <span>Streaming</span>
        </label>
      </div>
      <div className="df-runbar-sep" />
      <button className="tb-btn small" onClick={handleValidate} disabled={validating || !pipeline?.id} title="Validate pipeline">
        <Icon name={validating ? 'loader' : 'shield'} size={11} /><span>{validating ? 'Validating…' : 'Validate'}</span>
      </button>
      <div className="df-sched-wrap">
        <button className={cx('tb-btn small', pipeline?.schedule_enabled && 'is-scheduled')}
                onClick={() => setSchedOpen(o => !o)} aria-haspopup="dialog" aria-expanded={schedOpen}
                title={pipeline?.schedule_enabled ? `Scheduled: ${pipeline.schedule}` : 'Schedule'}>
          <Icon name="clock" size={11} /><span>Schedule</span>
          {pipeline?.schedule_enabled ? <span className="df-sched-dot" aria-label="Schedule enabled" /> : null}
        </button>
        {schedOpen && <SchedulePopover pipeline={pipeline} onClose={closeSched} />}
      </div>
    </div>
  );
}

// ---- top bar ------------------------------------------------------------------------
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
  const { forceSave } = useRunController();
  const [leaving, setLeaving] = useState(false);

  const handleBack = useCallback(async () => {
    setLeaving(true);
    const ok = await forceSave();
    setLeaving(false);
    if (ok) closePipeline();
  }, [forceSave, closePipeline]);

  return (
    <>
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
            <button className="df-crumb-link" onClick={handleBack} disabled={leaving}>{leaving ? 'Saving…' : 'All pipelines'}</button>
            <span className="df-crumb muted">/</span>
            <PipelineTitle pipeline={pipeline} />
            {pipelineDirty && <span className="df-dirty-dot" title="Unsaved changes" aria-label="Unsaved changes"></span>}
            <button className="iconbtn-sm" onClick={toggleStar}
                    aria-pressed={!!pipeline?.starred}
                    aria-label={pipeline?.starred ? 'Unstar pipeline' : 'Star pipeline'}
                    title={pipeline?.starred ? 'Unstar' : 'Star'}
                    style={{ marginLeft: 2, color: pipeline?.starred ? 'var(--warn)' : 'var(--text-3)' }}>
              <Icon name="star" size={11} />
            </button>
            <span className="df-top-group">
              <button className="iconbtn-sm" onClick={undo} disabled={undoStack.length === 0} aria-label="Undo" title="Undo (⌘Z)">
                <Icon name="chevron-left" size={11} />
              </button>
              <button className="iconbtn-sm" onClick={redo} disabled={redoStack.length === 0} aria-label="Redo" title="Redo (⌘⇧Z)">
                <Icon name="chevron-right" size={11} />
              </button>
              <button className="iconbtn-sm" onClick={() => getCanvasApi()?.fit()} aria-label="Fit canvas to view" title="Fit to view">
                <Icon name="maximize" size={11} />
              </button>
            </span>
          </>
        )}
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
    {view === 'editor' && (
      <div className="df-toolbar" role="toolbar" aria-label="Run controls">
        <DFRunBar />
      </div>
    )}
    </>
  );
}

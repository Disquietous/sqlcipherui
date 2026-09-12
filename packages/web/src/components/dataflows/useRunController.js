import { useEffect } from 'react';
import { useDataFlowStore } from '../../stores/dataflow';
import {
  updatePipeline, streamRun, cancelRun as apiCancelRun, validatePipeline,
} from '../../api/dataflow';

/*
 * Single implementation of the pipeline run / save / validate lifecycle.
 * Module-level state (one editor is open at a time) so DFTopBar, DFEditor and
 * the dock all drive the same stream handle and save timer.
 */

let saveTimer = null;
let runHandle = null;
let stopRequested = false;
let canvasApi = null;

// ---- canvas api bus (fit / zoom exposed by DFCanvas to the top bar) ------
export const registerCanvasApi = (api) => { canvasApi = api; };
export const getCanvasApi = () => canvasApi;

const nowIso = () => new Date().toISOString();

export function fmtDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

export function fmtRows(n) {
  return n == null ? '--' : Number(n).toLocaleString();
}

export function summarizeRun(result) {
  const r = result || {};
  const rows = fmtRows(r.total_rows);
  const dur = fmtDuration(r.duration_ms);
  switch (r.status) {
    case 'ok': return `Run ok — ${rows} rows in ${dur}`;
    case 'partial': return `Run partial — ${rows} rows in ${dur}${r.error ? `: ${r.error}` : ''}`;
    case 'failed': return `Run failed: ${r.error || 'unknown error'}`;
    case 'cancelled': return 'Run cancelled';
    default: return `Run ${r.status || 'finished'} — ${rows} rows in ${dur}`;
  }
}

export function statusLevel(status) {
  if (status === 'ok') return 'ok';
  if (status === 'partial') return 'warn';
  if (status === 'failed') return 'error';
  return 'info';
}

function pipelinePayload(p) {
  const body = {
    name: p.name,
    description: p.description,
    starred: p.starred,
    tags: p.tags,
    definition: p.definition,
    schedule: p.schedule,
    schedule_enabled: p.schedule_enabled,
  };
  Object.keys(body).forEach(k => { if (body[k] === undefined) delete body[k]; });
  return body;
}

/**
 * Flush any pending autosave and persist the pipeline now.
 * Resolves `true` when nothing needed saving or the save succeeded.
 * On failure the pipeline stays dirty and a toast is shown.
 */
export async function forceSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const s = useDataFlowStore.getState();
  const p = s.pipeline;
  if (!p?.id || !s.pipelineDirty) return true;
  try {
    await updatePipeline(p.id, pipelinePayload(p));
    const after = useDataFlowStore.getState();
    // Only clear the dirty flag when nothing changed while the request was in flight.
    if (after.pipeline === p) after.setPipelineDirty(false);
    return true;
  } catch (err) {
    useDataFlowStore.getState().pushToast({ level: 'error', message: `Save failed: ${err.message}` });
    return false;
  }
}

/** Debounced autosave; flushes on unmount. Mount once in DFEditor. */
export function useAutosave(delay = 600) {
  const pipelineDirty = useDataFlowStore((s) => s.pipelineDirty);
  const pipeline = useDataFlowStore((s) => s.pipeline);

  useEffect(() => {
    if (!pipelineDirty || !pipeline?.id) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; forceSave(); }, delay);
  }, [pipelineDirty, pipeline, delay]);

  useEffect(() => () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    forceSave();
  }, []);
}

function handleRunEvent(ev) {
  const g = useDataFlowStore.getState();
  switch (ev.type) {
    case 'status':
      if (ev.run_id != null) g.setActiveRunId(ev.run_id);
      if (ev.status && ev.status !== 'running') {
        g.setRunStatus({ ...(g.runStatus || {}), status: ev.status });
      }
      g.appendRunEvent(ev);
      break;
    case 'log':
      g.appendRunEvent(ev);
      break;
    case 'progress':
      if (ev.node_id) g.updateNodeCounter(ev.node_id, ev.in_rows ?? 0, ev.out_rows ?? 0);
      break;
    case 'edge_progress':
      if (ev.from && ev.to) g.updateEdgeCounter(ev.from, ev.to, ev.rows ?? 0);
      break;
    case 'done': {
      const r = ev.result || {};
      g.setRunStatus(r);
      g.appendRunEvent({
        type: 'summary', level: statusLevel(r.status), status: r.status,
        message: summarizeRun(r), timestamp: ev.timestamp || nowIso(),
      });
      if (r.status === 'failed') g.pushToast({ level: 'error', message: summarizeRun(r) });
      break;
    }
    case 'error': {
      const message = ev.message || 'Run failed';
      g.setRunStatus({ status: 'failed', error: message });
      g.appendRunEvent({ type: 'log', level: 'error', message, timestamp: ev.timestamp || nowIso() });
      g.pushToast({ level: 'error', message });
      break;
    }
    default:
      g.appendRunEvent(ev);
  }
}

function handleRunDone() {
  runHandle = null;
  const g = useDataFlowStore.getState();
  if (!g.runStatus) {
    // Stream closed without a `done` event (aborted or connection dropped).
    const status = stopRequested ? 'cancelled' : 'failed';
    const error = stopRequested ? null : 'Connection closed before the run finished';
    g.setRunStatus({ status, error });
    g.appendRunEvent({
      type: 'summary', level: statusLevel(status), status,
      message: stopRequested ? 'Run cancelled' : `Run failed: ${error}`, timestamp: nowIso(),
    });
    if (!stopRequested) g.pushToast({ level: 'error', message: error });
  } else if (stopRequested && g.runStatus.status !== 'cancelled' && !g.runEvents.some(e => e.type === 'summary')) {
    g.appendRunEvent({ type: 'summary', level: 'info', status: 'cancelled', message: 'Run cancelled', timestamp: nowIso() });
  }
  g.setIsRunning(false);
}

/** Save pending edits, then start a streaming run in the current run mode. */
export async function triggerRun() {
  const s = useDataFlowStore.getState();
  if (!s.pipeline?.id || s.isRunning) return;
  if (!(s.pipeline.definition?.nodes || []).length) {
    s.pushToast({ level: 'info', message: 'Add at least one node before running.' });
    return;
  }
  if (s.pipelineDirty) {
    const ok = await forceSave();
    if (!ok) return;
  }
  const st = useDataFlowStore.getState();
  if (st.isRunning || !st.pipeline?.id) return;
  stopRequested = false;
  st.startRun();
  st.setDockTab('log');
  st.appendRunEvent({
    type: 'log', level: 'info',
    message: `Starting ${st.runMode} run…`, timestamp: nowIso(),
  });
  runHandle = streamRun(
    st.pipeline.id,
    { mode: st.runMode, transactional: st.transactional, streaming_counters: st.streamingCounters },
    handleRunEvent,
    handleRunDone,
  );
}

/** Ask the backend to cancel the active run, then drop the stream. */
export async function stopRun() {
  const g = useDataFlowStore.getState();
  if (!g.isRunning) return;
  stopRequested = true;
  const id = g.activeRunId;
  if (id != null) {
    try {
      await apiCancelRun(id);
    } catch (err) {
      useDataFlowStore.getState().pushToast({ level: 'error', message: `Cancel failed: ${err.message}` });
    }
  }
  runHandle?.abort();
}

/**
 * Save, then validate the pipeline on the server. Stores the issues in the
 * store (`validationIssues`) so canvas nodes can show dots. Returns the list,
 * or null when the request failed (a toast is shown).
 */
export async function runValidation({ quiet = false } = {}) {
  const s = useDataFlowStore.getState();
  if (!s.pipeline?.id) return null;
  if (s.pipelineDirty) {
    const ok = await forceSave();
    if (!ok) return null;
  }
  useDataFlowStore.getState().setValidationLoading(true);
  try {
    const result = await validatePipeline(s.pipeline.id);
    const issues = Array.isArray(result) ? result : result?.issues || [];
    const g = useDataFlowStore.getState();
    g.setValidationIssues(issues);
    if (!quiet) {
      const errors = issues.filter(i => i.level === 'error').length;
      const warns = issues.length - errors;
      const message = issues.length === 0
        ? 'Pipeline is valid.'
        : `${errors} error${errors === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}`;
      g.pushToast({ level: issues.length === 0 ? 'ok' : errors ? 'error' : 'info', message });
    }
    return issues;
  } catch (err) {
    useDataFlowStore.getState().pushToast({ level: 'error', message: `Validation failed: ${err.message}` });
    return null;
  } finally {
    useDataFlowStore.getState().setValidationLoading(false);
  }
}

/** Public surface: stable module functions, safe to call from any component. */
export function useRunController() {
  return { triggerRun, stopRun, forceSave, runValidation };
}

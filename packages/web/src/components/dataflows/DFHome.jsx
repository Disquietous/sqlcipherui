import { useCallback, useEffect } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { getPipeline, deletePipeline, getPipelines, getStats } from '../../api/dataflow';
import { DFPipelineCard } from './DFPipelineCard';

function DFPipelineSection({ title, pipelines, onOpen, onDelete }) {
  return (
    <div className="df-section">
      <div className="df-section-h">
        <h3 className="df-section-title">{title}</h3>
        <div className="muted small">{pipelines.length} {pipelines.length === 1 ? 'pipeline' : 'pipelines'}</div>
      </div>
      <div className="df-grid">
        {pipelines.map(p => (
          <DFPipelineCard key={p.id} pipeline={p} onClick={() => onOpen(p)} onDelete={() => onDelete(p)} />
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value, loading, tone }) {
  return (
    <div className={`kpi${tone ? ` kpi-${tone}` : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{loading ? <span className="df-skeleton" aria-label="Loading" /> : value}</div>
    </div>
  );
}

const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString());

export function DFHome({ onOpenPipeline }) {
  const pipelines = useDataFlowStore((s) => s.pipelines);
  const pipelinesLoading = useDataFlowStore((s) => s.pipelinesLoading);
  const stats = useDataFlowStore((s) => s.stats);
  const dfConnections = useDataFlowStore((s) => s.dfConnections);
  const setPipelines = useDataFlowStore((s) => s.setPipelines);
  const setStats = useDataFlowStore((s) => s.setStats);
  const setModal = useDataFlowStore((s) => s.setModal);
  const setView = useDataFlowStore((s) => s.setView);

  useEffect(() => {
    let cancelled = false;
    getStats()
      .then(s => { if (!cancelled) setStats(s); })
      .catch(e => { if (!cancelled) useDataFlowStore.getState().pushToast({ level: 'error', message: `Could not load run statistics: ${e.message}` }); });
    return () => { cancelled = true; };
  }, [setStats, pipelines]);

  const starred = pipelines.filter(p => p.starred);
  const rest = pipelines.filter(p => !p.starred);

  const handleOpen = async (p) => {
    try {
      onOpenPipeline(await getPipeline(p.id));
    } catch (e) {
      useDataFlowStore.getState().pushToast({ level: 'error', message: `Could not open "${p.name}": ${e.message}` });
    }
  };

  const handleDelete = useCallback(async (p) => {
    if (!window.confirm(`Delete pipeline "${p.name}"? This also removes its run history and cannot be undone.`)) return;
    try {
      await deletePipeline(p.id);
      setPipelines(await getPipelines());
      useDataFlowStore.getState().pushToast({ level: 'ok', message: `Deleted "${p.name}".` });
    } catch (e) {
      useDataFlowStore.getState().pushToast({ level: 'error', message: `Delete failed: ${e.message}` });
    }
  }, [setPipelines]);

  const initialLoad = pipelinesLoading && pipelines.length === 0;
  const statsLoading = stats == null;

  return (
    <div className="df-home">
      <div className="df-home-hero">
        <div>
          <h1 className="df-home-title">Data Flows</h1>
          <p className="df-home-sub">Build, run, and reuse ETL pipelines across your local SQLite and SQLCipher databases.</p>
        </div>
        <div className="df-home-stats">
          <Kpi label="Pipelines" value={fmt(pipelines.length)} loading={initialLoad} />
          <Kpi label="Runs (7d)" value={fmt(stats?.runs)} loading={statsLoading} />
          <Kpi label="Rows moved (7d)" value={fmt(stats?.rows_moved)} loading={statsLoading} />
          <Kpi label="Failed (7d)" value={fmt(stats?.failed)} loading={statsLoading} tone={stats?.failed > 0 ? 'err' : undefined} />
        </div>
      </div>

      <div className="df-home-cta">
        <button type="button" className="df-cta df-cta-primary" onClick={() => setModal('new')}>
          <Icon name="plus" size={14} />
          <div><b>New pipeline</b><span className="muted small">Build from scratch on a blank canvas</span></div>
        </button>
        <button type="button" className="df-cta" onClick={() => setModal('templates')}>
          <Icon name="beaker" size={14} />
          <div><b>From a template</b><span className="muted small">Common patterns like dev-to-prod, encrypt, dedupe</span></div>
        </button>
        <button type="button" className="df-cta" onClick={() => setModal('connections')}>
          <Icon name="database" size={14} />
          <div><b>Connections</b><span className="muted small">{dfConnections.length} registered database{dfConnections.length === 1 ? '' : 's'}</span></div>
        </button>
        <button type="button" className="df-cta" onClick={() => setView('guide')}>
          <Icon name="book" size={14} />
          <div><b>Guide</b><span className="muted small">Learn how to build and run pipelines</span></div>
        </button>
      </div>

      {initialLoad && (
        <div className="df-section">
          <div className="df-grid" aria-busy="true">
            {[0, 1, 2].map(i => <div key={i} className="df-card df-card-skeleton" aria-hidden="true" />)}
          </div>
        </div>
      )}

      {!initialLoad && pipelines.length === 0 && (
        <div className="df-home-empty">
          <Icon name="play-circle" size={28} />
          <h3>No pipelines yet</h3>
          <p className="muted">Create one from scratch or start from a template. Pipelines are saved automatically as you edit.</p>
          <div className="df-inline">
            <button type="button" className="btn btn-primary" onClick={() => setModal('new')}><Icon name="plus" size={11} /> New pipeline</button>
            <button type="button" className="btn" onClick={() => setModal('templates')}><Icon name="beaker" size={11} /> Browse templates</button>
          </div>
        </div>
      )}

      {starred.length > 0 && (
        <DFPipelineSection title="Starred" pipelines={starred} onOpen={handleOpen} onDelete={handleDelete} />
      )}
      {rest.length > 0 && (
        <DFPipelineSection title={starred.length > 0 ? 'All pipelines' : 'Pipelines'} pipelines={rest} onOpen={handleOpen} onDelete={handleDelete} />
      )}
    </div>
  );
}

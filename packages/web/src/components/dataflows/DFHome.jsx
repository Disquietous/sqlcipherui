import { useCallback } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import { getPipeline, deletePipeline, getPipelines } from '../../api/dataflow';
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

export function DFHome({ onOpenPipeline }) {
  const pipelines = useDataFlowStore((s) => s.pipelines);
  const dfConnections = useDataFlowStore((s) => s.dfConnections);
  const setPipelines = useDataFlowStore((s) => s.setPipelines);
  const setModal = useDataFlowStore((s) => s.setModal);
  const setView = useDataFlowStore((s) => s.setView);

  const starred = pipelines.filter(p => p.starred);
  const rest = pipelines.filter(p => !p.starred);

  const handleOpen = async (p) => {
    try {
      const full = await getPipeline(p.id);
      onOpenPipeline(full);
    } catch {
      onOpenPipeline(p);
    }
  };

  const handleDelete = useCallback(async (p) => {
    try {
      await deletePipeline(p.id);
      const updated = await getPipelines();
      setPipelines(updated);
    } catch { /* ignore */ }
  }, [setPipelines]);

  return (
    <div className="df-home">
      <div className="df-home-hero">
        <div>
          <h1 className="df-home-title">Data Flows</h1>
          <p className="df-home-sub">Build, run, and reuse ETL pipelines across your local SQLite and SQLCipher databases.</p>
        </div>
        <div className="df-home-stats">
          <div className="kpi"><div className="kpi-label">Pipelines</div><div className="kpi-value">{pipelines.length}</div></div>
          <div className="kpi"><div className="kpi-label">Runs (7d)</div><div className="kpi-value">--</div></div>
          <div className="kpi"><div className="kpi-label">Rows moved</div><div className="kpi-value">--</div></div>
        </div>
      </div>

      <div className="df-home-cta">
        <button className="df-cta df-cta-primary" onClick={() => setModal('new')}>
          <Icon name="plus" size={14} />
          <div><b>New pipeline</b><span className="muted small">Build from scratch on a blank canvas</span></div>
        </button>
        <button className="df-cta" onClick={() => setModal('templates')}>
          <Icon name="beaker" size={14} />
          <div><b>From a template</b><span className="muted small">Common patterns like dev-to-prod, encrypt, dedupe</span></div>
        </button>
        <button className="df-cta" onClick={() => setModal('connections')}>
          <Icon name="database" size={14} />
          <div><b>Connections</b><span className="muted small">{dfConnections.length} registered databases &amp; files</span></div>
        </button>
        <button className="df-cta" onClick={() => setView('guide')}>
          <Icon name="book" size={14} />
          <div><b>Guide</b><span className="muted small">Learn how to build and run pipelines</span></div>
        </button>
      </div>

      {starred.length > 0 && (
        <DFPipelineSection title="Starred" pipelines={starred} onOpen={handleOpen} onDelete={handleDelete} />
      )}
      <DFPipelineSection title="All pipelines" pipelines={rest} onOpen={handleOpen} onDelete={handleDelete} />
    </div>
  );
}

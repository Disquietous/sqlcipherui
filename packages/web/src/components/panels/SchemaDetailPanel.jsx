import { useState, useEffect } from 'react';
import { Icon } from '../icons/Icon';
import { getIndexes, getTriggers } from '../../api/schema';

export function SchemaDetailPanel({ name, kind, db }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fetch = kind === 'index'
      ? getIndexes(db).then(list => list.find(i => i.name === name))
      : getTriggers(db).then(list => list.find(t => t.name === name));
    fetch
      .then(d => { if (!cancelled) setDetail(d || null); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [name, kind, db]);

  if (loading) {
    return <div className="panel" style={{ padding: 24, color: 'var(--text-3)' }}>Loading...</div>;
  }

  if (!detail) {
    return <div className="panel" style={{ padding: 24, color: 'var(--text-3)' }}>Not found: {name}</div>;
  }

  if (kind === 'index') {
    return (
      <div className="panel" style={{ padding: 24 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '1.154em', fontWeight: 600 }}>
          <Icon name="key" size={14} /> Index: <span className="mono">{detail.name}</span>
        </h3>
        <div className="row-kv"><span>Table</span><b className="mono">{detail.table_name}</b></div>
        <div className="row-kv"><span>Columns</span><b className="mono">{(detail.columns || []).join(', ')}</b></div>
        <div className="row-kv"><span>Unique</span><b>{detail.unique ? 'Yes' : 'No'}</b></div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ padding: 24 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.154em', fontWeight: 600 }}>
        <Icon name="settings" size={14} /> Trigger: <span className="mono">{detail.name}</span>
      </h3>
      <div className="row-kv"><span>Table</span><b className="mono">{detail.table_name}</b></div>
      <div className="row-kv"><span>Event</span><b className="mono">{detail.event}</b></div>
      <pre className="mono" style={{ marginTop: 16, padding: 12, background: 'var(--bg-2)', borderRadius: 6, whiteSpace: 'pre-wrap', fontSize: '0.923em' }}>
        {detail.sql}
      </pre>
    </div>
  );
}

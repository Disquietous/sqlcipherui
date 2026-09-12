import { useState } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';
import {
  createDfConnection, updateDfConnection, deleteDfConnection, getDfConnections,
} from '../../api/dataflow';
import { DFCheckbox, DFField, DFModal, DFText } from './DFFormWidgets';

const cx = (...xs) => xs.filter(Boolean).join(' ');

const EMPTY = { name: '', path: '', encrypted: false };

function ConnForm({ initial, onCancel, onSave, busy }) {
  const [form, setForm] = useState(initial || EMPTY);
  const valid = form.name.trim() && form.path.trim();
  const submit = (e) => {
    e.preventDefault();
    if (!valid || busy) return;
    onSave({ name: form.name.trim(), path: form.path.trim(), encrypted: !!form.encrypted, kind: 'sqlite' });
  };
  return (
    <form className="df-conn-form" onSubmit={submit}>
      <div className="df-conn-form-grid">
        <DFField label="Name">
          <DFText value={form.name} onChange={v => setForm({ ...form, name: v })} placeholder="Production" ariaLabel="Connection name" autoFocus />
        </DFField>
        <DFField label="Database file path">
          <DFText value={form.path} onChange={v => setForm({ ...form, path: v })} placeholder="/path/to/database.db" ariaLabel="Database path" mono />
        </DFField>
      </div>
      <DFCheckbox checked={form.encrypted} onChange={v => setForm({ ...form, encrypted: v })} label="Encrypted (SQLCipher)" hint="Nodes that use this connection will need the key, or the database must be unlocked in the app." />
      <div className="df-mod-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!valid || busy}>{busy ? 'Saving…' : initial?.id ? 'Save changes' : 'Add connection'}</button>
      </div>
    </form>
  );
}

export function DFConnectionsPanel({ onClose }) {
  const dfConnections = useDataFlowStore((s) => s.dfConnections);
  const setDfConnections = useDataFlowStore((s) => s.setDfConnections);
  const [editing, setEditing] = useState(null); // null | 'new' | connection object
  const [busy, setBusy] = useState(false);

  const toast = (t) => useDataFlowStore.getState().pushToast(t);

  const refresh = async () => setDfConnections(await getDfConnections());

  const handleSave = async (data) => {
    setBusy(true);
    try {
      if (editing && editing !== 'new') {
        await updateDfConnection(editing.id, data);
        toast({ level: 'ok', message: `Updated connection "${data.name}".` });
      } else {
        await createDfConnection(data);
        toast({ level: 'ok', message: `Added connection "${data.name}".` });
      }
      await refresh();
      setEditing(null);
    } catch (e) {
      toast({ level: 'error', message: `Could not save connection: ${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (c) => {
    if (!window.confirm(`Remove connection "${c.name}"? The database file itself is not touched.`)) return;
    try {
      await deleteDfConnection(c.id);
      await refresh();
      toast({ level: 'ok', message: `Removed connection "${c.name}".` });
    } catch (e) {
      toast({ level: 'error', message: `Could not remove connection: ${e.message}` });
    }
  };

  return (
    <DFModal
      title="Connections"
      icon={<Icon name="database" size={16} style={{ color: 'var(--accent)' }} />}
      onClose={onClose}
      width={680}
      flush
      headActions={
        <button type="button" className="btn btn-primary small" onClick={() => setEditing('new')} disabled={editing === 'new'}>
          <Icon name="plus" size={10} /> Add connection
        </button>
      }
    >
      <div className="df-conn-intro muted small">
        Databases open in the app are always available to nodes. Register additional .db / SQLCipher files here so they appear in every database picker.
      </div>

      {editing === 'new' && <ConnForm onCancel={() => setEditing(null)} onSave={handleSave} busy={busy} />}

      <div className="df-conn-list">
        <div className="df-conn-h">
          <div>Name</div><div>Type</div><div>Path</div><div>Status</div><div></div>
        </div>
        {dfConnections.length === 0 && editing !== 'new' && (
          <div className="df-empty">No registered connections yet.</div>
        )}
        {dfConnections.map(c => (
          editing && editing !== 'new' && editing.id === c.id ? (
            <ConnForm key={c.id} initial={{ id: c.id, name: c.name, path: c.path, encrypted: !!c.encrypted }} onCancel={() => setEditing(null)} onSave={handleSave} busy={busy} />
          ) : (
            <div key={c.id} className="df-conn-row">
              <div className="df-conn-name">
                <Icon name="database" size={12} />
                <span>{c.name}</span>
                {c.encrypted ? <span className="df-conn-lock" title="Encrypted"><Icon name="lock" size={9} /></span> : null}
              </div>
              <div className="mono small muted">{c.kind || 'sqlite'}</div>
              <div className="mono small muted df-ellipsis" title={c.path}>{c.path}</div>
              <div>
                <span className={cx('pill small', (c.status === 'unlocked' || c.status === 'open') ? 'pill-ok' : 'pill-soft')}>{c.status || 'closed'}</span>
              </div>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <button type="button" className="iconbtn-sm" title="Edit" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Icon name="edit" size={11} /></button>
                <button type="button" className="iconbtn-sm" title="Remove" aria-label={`Remove ${c.name}`} onClick={() => handleRemove(c)}><Icon name="trash" size={11} /></button>
              </div>
            </div>
          )
        ))}
      </div>
    </DFModal>
  );
}

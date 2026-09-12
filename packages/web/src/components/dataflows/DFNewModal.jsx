import { useState } from 'react';
import { Icon } from '../icons/Icon';
import { DFField, DFModal, DFText } from './DFFormWidgets';

const parseTags = (s) => [...new Set(s.split(',').map(t => t.trim()).filter(Boolean))];

export function DFNewModal({ onClose, onCreate, onPickTemplate, busy }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [touched, setTouched] = useState(false);

  const trimmed = name.trim();
  const valid = trimmed.length > 0;

  const submit = (e) => {
    e?.preventDefault();
    setTouched(true);
    if (!valid || busy) return;
    onCreate({ name: trimmed, description: description.trim(), tags: parseTags(tags) });
  };

  return (
    <DFModal title="New pipeline" icon={<Icon name="plus" size={16} style={{ color: 'var(--accent)' }} />} onClose={onClose} width={480}>
      <form className="df-form" onSubmit={submit}>
        <DFField label="Name" hint={touched && !valid ? 'A name is required.' : undefined}>
          <input
            className={`df-input${touched && !valid ? ' is-invalid' : ''}`}
            data-autofocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Nightly prod → dev refresh"
            aria-label="Pipeline name"
            aria-invalid={touched && !valid}
            required
          />
        </DFField>
        <DFField label="Description">
          <DFText value={description} onChange={setDescription} placeholder="What does this pipeline do? (optional)" ariaLabel="Description" />
        </DFField>
        <DFField label="Tags" hint="Comma-separated, optional.">
          <DFText value={tags} onChange={setTags} placeholder="migration, nightly" ariaLabel="Tags" mono />
        </DFField>

        <div className="df-mod-actions">
          <button type="button" className="btn" onClick={onPickTemplate} disabled={busy}>
            <Icon name="beaker" size={11} /> From template…
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || (touched && !valid)}>
            {busy ? 'Creating…' : 'Create blank pipeline'}
          </button>
        </div>
      </form>
    </DFModal>
  );
}

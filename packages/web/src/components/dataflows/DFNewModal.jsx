import { Icon } from '../icons/Icon';

export function DFNewModal({ onClose, onPickBlank, onPickTemplate }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
        <h3 className="modal-title" style={{ textAlign: 'left' }}>New pipeline</h3>
        <div className="muted small" style={{ textAlign: 'left', marginBottom: 18 }}>
          Start from scratch on a blank canvas, or use a template.
        </div>
        <div className="df-new-options">
          <button className="df-new-opt" onClick={() => onPickBlank('Untitled pipeline')}>
            <div className="df-new-ic"><Icon name="plus" size={16} /></div>
            <div>
              <b>Blank canvas</b>
              <div className="muted small">Add nodes manually</div>
            </div>
          </button>
          <button className="df-new-opt" onClick={onPickTemplate}>
            <div className="df-new-ic"><Icon name="beaker" size={16} /></div>
            <div>
              <b>From template</b>
              <div className="muted small">Pick a pre-built pipeline</div>
            </div>
          </button>
        </div>
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

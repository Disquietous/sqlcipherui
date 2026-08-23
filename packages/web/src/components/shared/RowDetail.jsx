import { useRef, useEffect, useCallback } from 'react';
import { Icon } from '../icons/Icon';
import { formatCell } from './DataGrid';

const MAX_HEIGHT = 200;

function AutoTextarea({ value }) {
  const ref = useRef(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);

  useEffect(() => { resize(); }, [value, resize]);

  return (
    <textarea
      ref={ref}
      className="row-detail-value mono"
      readOnly
      value={value}
    />
  );
}

export function RowDetail({ columns, row, rowIndex, onClose }) {
  if (!row) return null;

  return (
    <div className="row-detail">
      <div className="row-detail-header">
        <span className="row-detail-title">Row {rowIndex + 1}</span>
        <button className="row-detail-close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="row-detail-body">
        {columns.map((col, ci) => (
          <div key={col.name || ci} className="row-detail-field">
            <label className="row-detail-label">
              {col.name}
              {col.type && <span className="row-detail-type">{col.type}</span>}
            </label>
            <AutoTextarea value={formatCell(row[ci])} />
          </div>
        ))}
      </div>
    </div>
  );
}

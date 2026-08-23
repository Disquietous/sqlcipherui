import React, { useState } from 'react';
import { Icon } from '../icons/Icon';

const cx = (...xs) => xs.filter(Boolean).join(' ');

export function cellClass(val, col) {
  if (val === null || val === undefined) return 'cell-null';
  const t = (col?.type || '').toUpperCase();
  if (t.includes('INT') || t.includes('REAL') || t.includes('FLOAT') || t.includes('NUM')) return 'cell-num';
  if (t.includes('BOOL')) return 'cell-bool';
  return 'cell-text';
}

export function formatCell(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  return String(val);
}

export function RowCells({ row, rowIndex, columns, selected, onSelect, onRowDetail, editCell, editValue, onStartEdit, onEditChange, onCommitEdit, onCancelEdit }) {
  return (
    <>
      <div
        className={cx('gc', 'gc-num', selected && 'is-sel')}
        onClick={onSelect}
        onDoubleClick={onRowDetail ? () => onRowDetail(rowIndex) : undefined}
      >
        {rowIndex + 1}
      </div>
      {row.map((val, ci) => {
        const isEditing = editCell && editCell.ri === rowIndex && editCell.ci === ci;
        return (
          <div
            key={ci}
            className={cx('gc', selected && 'is-sel', isEditing && 'is-editing', cellClass(val, columns[ci]))}
            onClick={onSelect}
            onDoubleClick={onStartEdit ? () => onStartEdit(rowIndex, ci, val) : undefined}
          >
            {isEditing ? (
              <input
                className="cell-input mono"
                value={editValue}
                onChange={(e) => onEditChange(e.target.value)}
                onBlur={onCommitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onCommitEdit();
                  if (e.key === 'Escape') onCancelEdit();
                }}
                autoFocus
              />
            ) : (
              formatCell(val)
            )}
          </div>
        );
      })}
    </>
  );
}

export function DataGrid({ columns, rows, sort, dir, onSort, selectedRow, onSelectRow, onRowDetail, editable, beforeRows }) {
  const [editCell, setEditCell] = useState(null);
  const [editValue, setEditValue] = useState('');

  const gridCols = columns.length
    ? `36px ${columns.map(() => 'max-content').join(' ')}`
    : '1fr';

  const startEdit = editable ? (ri, ci, val) => {
    setEditCell({ ri, ci });
    setEditValue(val === null || val === undefined ? '' : String(val));
  } : null;

  const commitEdit = () => {
    if (!editCell) return;
    const oldVal = rows[editCell.ri][editCell.ci];
    const oldStr = oldVal === null || oldVal === undefined ? '' : String(oldVal);
    if (editValue !== oldStr && editable?.onCellUpdate) {
      editable.onCellUpdate(editCell.ri, editCell.ci, editValue);
    }
    setEditCell(null);
  };

  const cancelEdit = () => setEditCell(null);

  return (
    <div className="grid" style={{ gridTemplateColumns: gridCols }}>
      <div className="gh gh-num">#</div>
      {columns.map((col, i) => (
        <div
          key={col.name || i}
          className="gh"
          onClick={onSort ? () => onSort(col.name) : undefined}
          style={onSort ? { cursor: 'pointer' } : undefined}
        >
          <span className="gh-name">{col.name}</span>
          {col.type && <span className="gh-type">{col.type}</span>}
          {col.pk ? <span className="badge badge-pk">PK</span> : null}
          {col.unique ? <span className="badge badge-uq">UQ</span> : null}
          {sort && sort === col.name && onSort && (
            <Icon name="sort-asc" size={12} style={dir === 'desc' ? { transform: 'rotate(180deg)' } : undefined} />
          )}
        </div>
      ))}
      {beforeRows}
      {rows.map((row, ri) => (
        <RowCells
          key={ri}
          row={row}
          rowIndex={ri}
          columns={columns}
          selected={selectedRow === ri}
          onSelect={onSelectRow ? () => onSelectRow(ri) : undefined}
          onRowDetail={onRowDetail}
          editCell={editCell}
          editValue={editValue}
          onStartEdit={startEdit}
          onEditChange={setEditValue}
          onCommitEdit={commitEdit}
          onCancelEdit={cancelEdit}
        />
      ))}
    </div>
  );
}

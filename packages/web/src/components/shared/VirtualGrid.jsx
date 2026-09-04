import { useRef, useMemo, useState, useLayoutEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { RowCells, formatCell } from './DataGrid';

const cx = (...xs) => xs.filter(Boolean).join(' ');

const MIN_COL = 40;   // px
const MAX_COL = 480;  // px
const CELL_PAD = 21;  // horizontal padding + borders

/**
 * Read-only virtualized results grid. Same look as DataGrid (reuses RowCells
 * and the .grid/.gh/.gc styles) but renders only the visible rows, so huge
 * result sets neither slow React nor browser layout.
 *
 * Uniform row height (--row-h) and fixed pixel column widths (derived from
 * the monospace cell font over the full data set) keep scrolling stable.
 */
export function VirtualGrid({ columns, rows, selectedRow, onSelectRow, onRowDetail, className = '' }) {
  const scrollRef = useRef(null);
  const [metrics, setMetrics] = useState({ charW: 7.4, rowH: 26 });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const probe = document.createElement('div');
    probe.className = 'gc';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.width = 'auto';
    probe.textContent = '0'.repeat(100);
    el.appendChild(probe);
    const charW = (probe.scrollWidth - CELL_PAD + 1) / 100 || 7.4;
    const rowH = probe.getBoundingClientRect().height || 26;
    el.removeChild(probe);
    setMetrics((m) => (Math.abs(m.charW - charW) < 0.01 && m.rowH === rowH ? m : { charW, rowH }));
  }, []);

  // Measured natural width of each header cell (name + type), in px.
  const [headerWidths, setHeaderWidths] = useState([]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const probe = document.createElement('div');
    probe.className = 'grid';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.gridTemplateColumns = columns.map(() => 'max-content').join(' ');
    for (const col of columns) {
      const h = document.createElement('div');
      h.className = 'gh';
      const name = document.createElement('span');
      name.className = 'gh-name';
      name.textContent = col.name || '';
      h.appendChild(name);
      if (col.type) {
        const type = document.createElement('span');
        type.className = 'gh-type';
        type.textContent = col.type;
        h.appendChild(type);
      }
      probe.appendChild(h);
    }
    el.appendChild(probe);
    const widths = Array.from(probe.children, (h) => Math.ceil(h.getBoundingClientRect().width) + 1);
    el.removeChild(probe);
    setHeaderWidths(widths);
  }, [columns]);

  // Natural (uncapped) content width of each column, in px.
  const contentWidths = useMemo(() => columns.map((col, ci) => {
    let maxLen = 0;
    for (let r = 0; r < rows.length; r++) {
      const len = formatCell(rows[r][ci]).length;
      if (len > maxLen) maxLen = len;
    }
    const cellW = Math.ceil(maxLen * metrics.charW) + CELL_PAD;
    return Math.max(MIN_COL, cellW, headerWidths[ci] || 0);
  }), [columns, rows, metrics, headerWidths]);

  // User-set widths (by column index); reset whenever the result set changes.
  const [overrides, setOverrides] = useState({});
  useLayoutEffect(() => { setOverrides({}); }, [columns, rows]);

  const gridCols = useMemo(() => {
    const widths = contentWidths.map((w, ci) => overrides[ci] ?? Math.min(MAX_COL, w));
    const numW = Math.max(36, String(rows.length).length * metrics.charW + 16);
    return `${Math.ceil(numW)}px ${widths.map((w) => `${w}px`).join(' ')}`;
  }, [contentWidths, overrides, rows.length, metrics]);

  const fitColumn = (ci) => setOverrides((o) => ({ ...o, [ci]: contentWidths[ci] }));

  const startResize = (e, ci) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = overrides[ci] ?? Math.min(MAX_COL, contentWidths[ci]);
    const onMove = (ev) => {
      const w = Math.max(MIN_COL, Math.round(startW + ev.clientX - startX));
      setOverrides((o) => (o[ci] === w ? o : { ...o, [ci]: w }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => metrics.rowH,
    overscan: 12,
  });

  const items = virtualizer.getVirtualItems();
  const total = virtualizer.getTotalSize();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? total - items[items.length - 1].end : 0;

  return (
    <div ref={scrollRef} className={cx('grid-wrap', className)}>
      <div className="grid" style={{ gridTemplateColumns: gridCols }}>
        <div className="gh gh-num">#</div>
        {columns.map((col, i) => (
          <div key={col.name || i} className="gh">
            <span className="gh-name">{col.name}</span>
            {col.type && <span className="gh-type">{col.type}</span>}
            <div
              className="gh-resize"
              title="Drag to resize, double-click to fit"
              onMouseDown={(e) => startResize(e, i)}
              onDoubleClick={(e) => { e.stopPropagation(); fitColumn(i); }}
            />
          </div>
        ))}
        {padTop > 0 && <div className="vgrid-spacer" style={{ height: padTop }} />}
        {items.map((item) => (
          <RowCells
            key={item.key}
            row={rows[item.index]}
            rowIndex={item.index}
            columns={columns}
            selected={selectedRow === item.index}
            onSelectRow={onSelectRow}
            onRowDetail={onRowDetail}
            editing={null}
          />
        ))}
        {padBottom > 0 && <div className="vgrid-spacer" style={{ height: padBottom }} />}
      </div>
    </div>
  );
}

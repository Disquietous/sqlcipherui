import { useState, useEffect, useCallback } from 'react';
import { fetchRows, insertRow, updateRow, deleteRow } from '../../api/data';
import { getTableDetail } from '../../api/schema';
import { Icon } from '../icons/Icon';
import { SqlReadOnly } from '../shared/SqlEditor';
import { DataGrid, formatCell, cellClass } from '../shared/DataGrid';
import { RowDetail } from '../shared/RowDetail';
import { QueryPanel } from './QueryPanel';

const cx = (...xs) => xs.filter(Boolean).join(' ');
const PAGE_SIZE = 200;

function exportCsv(columns, rows, tableName) {
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(c => escape(c.name)).join(',');
  const body = rows.map(r => r.map(escape).join(',')).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${tableName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DataPanel({ table, db }) {
  const [subtab, setSubtab] = useState('query');
  const [allRows, setAllRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(null);
  const [dir, setDir] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [detail, setDetail] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setSubtab('query');
    setAllRows([]);
    setColumns([]);
    setTotal(0);
    setHasMore(true);
    setSearch('');
    setSort(null);
    setDir(null);
    setSelectedRow(null);
    setDetail(null);
  }, [table]);

  useEffect(() => {
    if (!table) return;
    let cancelled = false;
    setAllRows([]);
    setHasMore(true);
    setLoading(true);
    fetchRows(table, { offset: 0, limit: PAGE_SIZE, sort, dir, search: search || undefined, db })
      .then((res) => {
        if (cancelled) return;
        setColumns(res.columns || []);
        setAllRows(res.rows || []);
        setTotal(res.total || 0);
        setHasMore((res.rows || []).length < (res.total || 0));
      })
      .catch(() => {
        if (!cancelled) { setAllRows([]); setColumns([]); setTotal(0); setHasMore(false); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [table, db, sort, dir, search, refreshKey]);

  useEffect(() => {
    if (!table) return;
    let cancelled = false;
    getTableDetail(table, db)
      .then((res) => { if (!cancelled) setDetail(res); })
      .catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [table, db]);

  function handleSort(colName) {
    if (sort === colName) {
      setDir(dir === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(colName);
      setDir('asc');
    }
  }

  function handleSearch(e) {
    setSearch(e.target.value);
  }

  const handleRefresh = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    setLoading(true);
    fetchRows(table, { offset: allRows.length, limit: PAGE_SIZE, sort, dir, search: search || undefined, db })
      .then((res) => {
        setAllRows(prev => [...prev, ...(res.rows || [])]);
        setHasMore(allRows.length + (res.rows || []).length < (res.total || 0));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [table, db, allRows.length, sort, dir, search, loading, hasMore]);

  const [draftRow, setDraftRow] = useState(null);

  const handleInsert = useCallback(() => {
    if (!columns.length || draftRow) return;
    setDraftRow(columns.map(col => {
      if (col.default_value != null) return String(col.default_value);
      return null;
    }));
  }, [columns, draftRow]);

  const handleDraftEdit = useCallback((ci, value) => {
    setDraftRow(prev => {
      const next = [...prev];
      next[ci] = value;
      return next;
    });
  }, []);

  const handleDraftSave = useCallback(async () => {
    if (!draftRow) return;
    const values = {};
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const v = draftRow[i];
      if (col.pk && col.type.toUpperCase().includes('INT') && (v === null || v === '')) continue;
      if (v === null || v === '') {
        values[col.name] = null;
      } else {
        values[col.name] = v;
      }
    }
    try {
      await insertRow(table, values, db);
      setDraftRow(null);
      handleRefresh();
    } catch (e) {
      alert('Insert failed: ' + e.message);
    }
  }, [table, db, columns, draftRow, handleRefresh]);

  const handleDraftDiscard = useCallback(() => {
    setDraftRow(null);
  }, []);

  const handleDelete = useCallback(async () => {
    if (selectedRow === null || !allRows[selectedRow]) return;
    const pkCols = columns.filter(c => c.pk);
    if (pkCols.length === 0) {
      alert('Cannot delete: table has no primary key');
      return;
    }
    const pk = {};
    for (const col of pkCols) {
      const ci = columns.findIndex(c => c.name === col.name);
      pk[col.name] = allRows[selectedRow][ci];
    }
    try {
      await deleteRow(table, pk, db);
      setSelectedRow(null);
      handleRefresh();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  }, [table, db, columns, allRows, selectedRow, handleRefresh]);

  const handleCellUpdate = useCallback(async (rowIndex, colIndex, newValue) => {
    const pkCols = columns.filter(c => c.pk);
    if (pkCols.length === 0) return;
    const pk = {};
    for (const col of pkCols) {
      const ci = columns.findIndex(c => c.name === col.name);
      pk[col.name] = allRows[rowIndex][ci];
    }
    const colName = columns[colIndex].name;
    const parsed = newValue === '' ? null : isNaN(newValue) ? newValue : Number(newValue);
    try {
      await updateRow(table, pk, { [colName]: parsed }, db);
      handleRefresh();
    } catch (e) {
      alert('Update failed: ' + e.message);
    }
  }, [table, db, columns, allRows, handleRefresh]);

  const subtabs = [
    { key: 'data', label: 'Data' },
    { key: 'structure', label: 'Structure' },
    { key: 'indexes', label: 'Indexes' },
    { key: 'triggers', label: 'Triggers' },
    { key: 'create', label: 'Create' },
    { key: 'query', label: 'Query' },
  ];

  return (
    <div className="panel">
      <div className="subtabs">
        {subtabs.map((t) => (
          <button
            key={t.key}
            className={cx('subtab', subtab === t.key && 'is-active')}
            onClick={() => setSubtab(t.key)}
          >
            {t.label}
          </button>
        ))}
        {subtab === 'data' && total > 0 && (
          <span className="muted small" style={{ marginLeft: 'auto', padding: '0 8px' }}>
            {allRows.length} of {total} row{total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {subtab === 'data' && <DataTab
        table={table}
        columns={columns}
        rows={allRows}
        total={total}
        loading={loading}
        hasMore={hasMore}
        search={search}
        sort={sort}
        dir={dir}
        selectedRow={selectedRow}
        draftRow={draftRow}
        onSort={handleSort}
        onSearch={handleSearch}
        onRefresh={handleRefresh}
        onSelectRow={setSelectedRow}
        onInsert={handleInsert}
        onDelete={handleDelete}
        onCellUpdate={handleCellUpdate}
        onDraftEdit={handleDraftEdit}
        onDraftSave={handleDraftSave}
        onDraftDiscard={handleDraftDiscard}
        loadMore={loadMore}
      />}

      {subtab === 'structure' && <StructureTab detail={detail} />}
      {subtab === 'indexes' && <IndexesTab detail={detail} />}
      {subtab === 'triggers' && <TriggersTab detail={detail} />}
      {subtab === 'create' && <SqlTab detail={detail} />}
      {subtab === 'query' && <QueryPanel key={`${db}::${table}`} initialSql={`SELECT * FROM "${table}" LIMIT 100;`} db={db} />}
    </div>
  );
}

function DataTab({
  table, columns, rows, total, loading, hasMore, search, sort, dir, selectedRow,
  draftRow, onSort, onSearch, onRefresh,
  onSelectRow, onInsert, onDelete, onCellUpdate, onDraftEdit, onDraftSave, onDraftDiscard,
  loadMore,
}) {
  const hasPk = columns.some(c => c.pk);
  const [detailRow, setDetailRow] = useState(null);

  const handleSelectRow = useCallback((ri) => {
    onSelectRow(ri);
    if (detailRow !== null) setDetailRow(ri);
  }, [onSelectRow, detailRow]);

  const handleScroll = useCallback((e) => {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      loadMore();
    }
  }, [loadMore]);

  const draftRowContent = draftRow ? (
    <>
      <div className="gc gc-num" style={{ background: 'var(--accent-soft)' }}>+</div>
      {draftRow.map((val, ci) => (
        <div key={ci} className="gc is-editing" style={{ background: 'var(--accent-soft)' }}>
          <input
            className="cell-input mono"
            value={val === null ? '' : val}
            placeholder={columns[ci]?.notnull && !columns[ci]?.default_value ? 'required' : 'NULL'}
            onChange={(e) => onDraftEdit(ci, e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onDraftSave();
              if (e.key === 'Escape') onDraftDiscard();
            }}
            autoFocus={ci === 0}
          />
        </div>
      ))}
    </>
  ) : null;

  return (
    <>
      <div className="toolbar">
        {draftRow ? (
          <>
            <button className="tb-btn tb-primary" onClick={onDraftSave}>
              <Icon name="check" size={12} /> Save row
            </button>
            <button className="tb-btn" onClick={onDraftDiscard}>
              <Icon name="close" size={12} /> Discard
            </button>
          </>
        ) : (
          <>
            <button className="tb-btn tb-primary" title="Insert row" onClick={onInsert} disabled={!hasPk}>
              <Icon name="plus" size={12} /> Insert
            </button>
            <button className="tb-btn" title="Delete row" onClick={onDelete} disabled={selectedRow === null || !hasPk}>
              <Icon name="minus" size={12} /> Delete
            </button>
          </>
        )}
        <div className="tb-sep" />
        <button className="tb-btn" onClick={onRefresh} title="Refresh">
          <Icon name="refresh" size={12} />
        </button>
        <div style={{ flex: 1 }} />
        <div className="tb-search">
          <Icon name="search" size={12} />
          <input
            type="text"
            placeholder="Filter rows..."
            value={search}
            onChange={onSearch}
          />
        </div>
        <button
          className="tb-btn"
          title="Export CSV"
          disabled={rows.length === 0}
          onClick={() => exportCsv(columns, rows, table)}
        >
          <Icon name="export" size={12} />
        </button>
      </div>

      <div className="grid-detail-split">
        <div className="grid-wrap" onScroll={handleScroll}>
          {loading && rows.length === 0 && (
            <div className="muted" style={{ padding: 16 }}>Loading...</div>
          )}
          {!loading && rows.length === 0 && (
            <div className="muted" style={{ padding: 16 }}>No data</div>
          )}
          {columns.length > 0 && (
            <DataGrid
              columns={columns}
              rows={rows}
              sort={sort}
              dir={dir}
              onSort={onSort}
              selectedRow={selectedRow}
              onSelectRow={handleSelectRow}
              onRowDetail={setDetailRow}
              editable={hasPk ? { onCellUpdate } : null}
              beforeRows={draftRowContent}
            />
          )}
          {hasMore && (
            <div style={{ padding: '12px 16px', color: 'var(--text-3)', fontSize: '0.923em' }}>
              {loading ? 'Loading more rows…' : ''}
            </div>
          )}
        </div>
        {detailRow !== null && rows[detailRow] && (
          <RowDetail
            columns={columns}
            row={rows[detailRow]}
            rowIndex={detailRow}
            onClose={() => setDetailRow(null)}
          />
        )}
      </div>
    </>
  );
}

function StructureTab({ detail }) {
  if (!detail) return <div className="muted" style={{ padding: 16 }}>Loading...</div>;
  const cols = detail.columns || [];
  const gridCols = '36px 1.4fr 1fr 60px 60px 60px 1.6fr';

  return (
    <div className="structure">
      <div className="grid-wrap">
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          <div className="gh gh-num">#</div>
          <div className="gh">Name</div>
          <div className="gh">Type</div>
          <div className="gh">PK</div>
          <div className="gh">NN</div>
          <div className="gh">UQ</div>
          <div className="gh">Default</div>

          {cols.map((col, i) => (
            <StructureRow key={col.name} col={col} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

function StructureRow({ col, index }) {
  return (
    <>
      <div className="gc gc-num">{index + 1}</div>
      <div className="gc cell-text">
        {col.name}
        {col.pk ? <span className="badge badge-pk">PK</span> : null}
      </div>
      <div className="gc mono muted">{col.type}</div>
      <div className="gc">{col.pk ? <Icon name="check" size={14} /> : null}</div>
      <div className="gc">{col.notnull ? <Icon name="check" size={14} /> : null}</div>
      <div className="gc">{col.unique ? <Icon name="check" size={14} /> : null}</div>
      <div className="gc mono muted">{col.default_value ?? ''}</div>
    </>
  );
}

function IndexesTab({ detail }) {
  if (!detail) return <div className="muted" style={{ padding: 16 }}>Loading...</div>;
  const indexes = detail.indexes || [];
  if (indexes.length === 0) return <div className="muted" style={{ padding: 16 }}>No indexes</div>;

  return (
    <div className="grid-wrap">
      <div className="grid" style={{ gridTemplateColumns: '36px 1.4fr 2fr 80px' }}>
        <div className="gh gh-num">#</div>
        <div className="gh">Name</div>
        <div className="gh">Columns</div>
        <div className="gh">Unique</div>

        {indexes.map((idx, i) => (
          <IndexRow key={idx.name} idx={idx} index={i} />
        ))}
      </div>
    </div>
  );
}

function IndexRow({ idx, index }) {
  return (
    <>
      <div className="gc gc-num">{index + 1}</div>
      <div className="gc cell-text">{idx.name}</div>
      <div className="gc mono muted">{(idx.columns || []).join(', ')}</div>
      <div className="gc">
        {idx.unique ? <span className="badge badge-uq">UQ</span> : null}
      </div>
    </>
  );
}

function TriggersTab({ detail }) {
  if (!detail) return <div className="muted" style={{ padding: 16 }}>Loading...</div>;
  const triggers = detail.triggers || [];
  if (triggers.length === 0) return <div className="muted" style={{ padding: 16 }}>No triggers</div>;

  return (
    <div className="grid-wrap">
      <div className="grid" style={{ gridTemplateColumns: '36px 1.2fr 1fr 3fr' }}>
        <div className="gh gh-num">#</div>
        <div className="gh">Name</div>
        <div className="gh">Event</div>
        <div className="gh">SQL</div>

        {triggers.map((trg, i) => (
          <TriggerRow key={trg.name} trg={trg} index={i} />
        ))}
      </div>
    </div>
  );
}

function TriggerRow({ trg, index }) {
  const truncSql = trg.sql && trg.sql.length > 120 ? trg.sql.slice(0, 120) + '...' : trg.sql;
  return (
    <>
      <div className="gc gc-num">{index + 1}</div>
      <div className="gc cell-text">{trg.name}</div>
      <div className="gc mono muted">{trg.event}</div>
      <div className="gc mono muted">{truncSql}</div>
    </>
  );
}

function SqlTab({ detail }) {
  if (!detail) return <div className="muted" style={{ padding: 16 }}>Loading...</div>;
  return <SqlReadOnly sql={detail.create_sql || '-- No CREATE statement available'} />;
}

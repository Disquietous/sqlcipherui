import React, { useState, useEffect, useCallback } from 'react';
import { executeQuery, explainQuery } from '../../api/query';
import { useHistoryStore } from '../../stores/history';
import { useSavedStore } from '../../stores/saved';
import { useUiStore } from '../../stores/ui';
import { useConnectionStore } from '../../stores/connection';
import { SqlEditor, Highlighted } from '../shared/SqlEditor';
import { DataGrid } from '../shared/DataGrid';
import { RowDetail } from '../shared/RowDetail';
import { Icon } from '../icons/Icon';

const cx = (...xs) => xs.filter(Boolean).join(' ');

const initialSql = 'SELECT * FROM sqlite_master LIMIT 10;';

function exportCsv(columns, rows, filename = 'query-results.csv') {
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(c => escape(c.name || c)).join(',');
  const body = rows.map(r => r.map(escape).join(',')).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function QueryPanel({ initialSql: initialSqlProp, db } = {}) {
  const [sqlText, setSqlText] = useState(initialSqlProp || initialSql);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeResultTab, setActiveResultTab] = useState('results');
  const [planResult, setPlanResult] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [detailRow, setDetailRow] = useState(null);

  const handleSelectRow = useCallback((ri) => {
    setSelectedRow(ri);
    if (detailRow !== null) setDetailRow(ri);
  }, [detailRow]);

  const connections = useConnectionStore((s) => s.connections);
  const activeDbId = useConnectionStore((s) => s.activeDbId);
  const [targetDb, setTargetDb] = useState(db || activeDbId);
  const connList = Object.values(connections).filter(c => c.unlocked || !c.encrypted);

  useEffect(() => {
    if (!targetDb || !connections[targetDb]) setTargetDb(db || activeDbId);
  }, [activeDbId, connections, db]);

  const addHistory = useHistoryStore((s) => s.addEntry);
  const saveQuery = useSavedStore((s) => s.save);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(async () => {
    if (!sqlText.trim()) return;
    const name = prompt('Save query as:', sqlText.trim().slice(0, 40));
    if (!name) return;
    await saveQuery(name, sqlText);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [sqlText, saveQuery]);

  const handleRun = useCallback(async () => {
    if (!sqlText.trim()) return;
    setLoading(true);
    setResult(null);
    setSelectedRow(null);
    setDetailRow(null);
    try {
      const res = await executeQuery(sqlText, targetDb);
      setResult(res);
      addHistory({ sql: sqlText, row_count: res.row_count, elapsed_ms: res.elapsed_ms, error: res.error });
      setActiveResultTab(res.error ? 'messages' : 'results');
    } catch (err) {
      const errResult = {
        columns: [],
        rows: [],
        row_count: 0,
        elapsed_ms: 0,
        error: err.message || 'Query failed',
      };
      setResult(errResult);
      addHistory({ sql: sqlText, row_count: 0, elapsed_ms: 0, error: errResult.error });
      setActiveResultTab('messages');
    } finally {
      setLoading(false);
    }
  }, [sqlText, targetDb, addHistory]);

  const pendingSQL = useUiStore((s) => s.pendingSQL);
  useEffect(() => {
    if (pendingSQL) {
      setSqlText(pendingSQL);
      useUiStore.getState().setPendingSQL(null);
    }
  }, [pendingSQL]);

  const handleStop = useCallback(() => {}, []);

  const handleExplain = useCallback(async () => {
    if (!sqlText.trim()) return;
    setPlanResult(null);
    try {
      const res = await explainQuery(sqlText, targetDb);
      setPlanResult(res);
    } catch (err) {
      setPlanResult({
        columns: [], rows: [], row_count: 0, elapsed_ms: 0,
        error: err.message || 'Explain failed',
      });
    }
  }, [sqlText, targetDb]);

  const statusText = result
    ? result.error
      ? 'Error'
      : `${result.elapsed_ms} ms · ${result.row_count} row${result.row_count !== 1 ? 's' : ''}`
    : null;

  return (
    <div className="panel query-panel">
      <div className="toolbar">
        <button className="tb-btn tb-primary" onClick={handleRun} disabled={loading}>
          <Icon name="play" size={11} />
          <span>Run</span>
          <kbd>⌘⏎</kbd>
        </button>
        <button className="tb-btn" onClick={handleStop} disabled={!loading}>
          <Icon name="stop" size={11} />
        </button>
        <div className="tb-sep" />
        <button className="tb-btn" onClick={handleSave} disabled={!sqlText.trim()}>
          <Icon name="star" size={11} />
          <span>{saved ? 'Saved!' : 'Save'}</span>
        </button>
        <button
          className="tb-btn"
          disabled={!result || !!result.error || !result.rows?.length}
          onClick={() => result && exportCsv(result.columns, result.rows)}
          title="Export CSV"
        >
          <Icon name="export" size={11} />
        </button>
        <div className="tb-sep" />
        <div className="tb-db-select">
          <Icon name="database" size={11} />
          <select
            className="tb-db-picker"
            value={targetDb || ''}
            onChange={(e) => setTargetDb(e.target.value)}
          >
            {connList.map(c => (
              <option key={c.path} value={c.path}>
                {c.name || c.path.split('/').pop()}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }} />
        {statusText && (
          <span className={cx('small', 'muted', 'mono')}>{statusText}</span>
        )}
      </div>

      <div className="splitter splitter-v">
        <div className="editor">
          <div className="editor-wrap">
            <SqlEditor
              value={sqlText}
              onChange={setSqlText}
              onRun={handleRun}
              minRows={6}
            />
          </div>
        </div>

        <div className="resultbar">
          <div className="resultbar-tabs">
            {['results', 'messages', 'plan'].map((tab) => (
              <button
                key={tab}
                className={cx('rb-tab', activeResultTab === tab && 'is-active')}
                onClick={() => setActiveResultTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="resultbar-meta">
            {result && (
              <span className={cx('pill', result.error ? 'pill-err' : 'pill-ok')}>
                {result.error ? 'error' : 'ok'}
              </span>
            )}
          </div>
        </div>

        {activeResultTab === 'results' && result && !result.error && (
          <div className="grid-detail-split">
            <div className="grid-wrap">
              {result.columns.length > 0 && (
                <DataGrid
                  columns={result.columns}
                  rows={result.rows}
                  selectedRow={selectedRow}
                  onSelectRow={handleSelectRow}
                  onRowDetail={setDetailRow}
                />
              )}
            </div>
            {detailRow !== null && result.rows[detailRow] && (
              <RowDetail
                columns={result.columns}
                row={result.rows[detailRow]}
                rowIndex={detailRow}
                onClose={() => setDetailRow(null)}
              />
            )}
          </div>
        )}

        {activeResultTab === 'messages' && (
          <div className="result-area">
            <div style={{ padding: '12px 16px' }}>
              {result?.error ? (
                <pre className="mono" style={{ color: 'var(--err)', whiteSpace: 'pre-wrap' }}>
                  {result.error}
                </pre>
              ) : result ? (
                <p className="muted">
                  <Icon name="check" size={14} />{' '}
                  Query executed successfully in {result.elapsed_ms} ms
                </p>
              ) : (
                <p className="muted">Run a query to see messages.</p>
              )}
            </div>
          </div>
        )}

        {activeResultTab === 'plan' && (
          <div className="result-area">
            <div style={{ padding: '12px 16px' }}>
              {!planResult ? (
                <button className="tb-btn" onClick={handleExplain}>
                  <Icon name="terminal" size={11} />
                  <span>Run EXPLAIN QUERY PLAN</span>
                </button>
              ) : planResult.error ? (
                <pre className="mono" style={{ color: 'var(--err)', whiteSpace: 'pre-wrap' }}>
                  {planResult.error}
                </pre>
              ) : (
                <pre className="mono small" style={{ whiteSpace: 'pre-wrap' }}>
                  {planResult.rows.map((row) => row.join(' | ')).join('\n')}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

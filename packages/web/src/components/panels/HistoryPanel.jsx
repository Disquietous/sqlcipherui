import { useState } from 'react';
import { Icon } from '../icons/Icon';
import { SqlReadOnly } from '../shared/SqlEditor';

const cx = (...xs) => xs.filter(Boolean).join(' ');

function exportHistory(history) {
  const lines = history.map(h =>
    `-- ${h.ts} | ${h.error ? 'ERROR: ' + h.error : h.row_count + ' rows'} | ${h.elapsed_ms} ms\n${h.sql}`
  );
  const blob = new Blob([lines.join('\n\n')], { type: 'text/sql' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'query-history.sql';
  a.click();
  URL.revokeObjectURL(url);
}

export function HistoryPanel({ history = [], onRunQuery, onRemove }) {
  const [search, setSearch] = useState('');

  const filtered = search
    ? history.filter(h => h.sql.toLowerCase().includes(search.toLowerCase()))
    : history;

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="tb-search">
          <Icon name="search" size={12} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search history…"
          />
        </div>
        <div style={{ flex: 1 }} />
        <button
          className="tb-btn"
          disabled={history.length === 0}
          onClick={() => exportHistory(history)}
        >
          <Icon name="export" size={12} /><span>Export</span>
        </button>
        <span className="muted small">{history.length} queries</span>
      </div>
      <div className="historylist">
        {filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: '1em' }}>
            {history.length === 0
              ? 'No queries executed yet. Run a query to see it here.'
              : 'No matching queries.'}
          </div>
        )}
        {filtered.map((h, i) => (
          <div key={i} className="hist-row">
            <div className="hist-meta">
              <span className="mono small muted">{h.ts}</span>
              <span className={cx('pill', h.error ? 'pill-err' : 'pill-ok')}>
                {h.error ? 'error' : `${h.row_count} rows`}
              </span>
              <span className="muted small">{h.elapsed_ms} ms</span>
            </div>
            <SqlReadOnly sql={h.sql} className="hist-sql" />
            <div className="hist-actions">
              <button
                className="iconbtn-sm"
                title="Run again"
                onClick={() => onRunQuery?.(h.sql)}
              >
                <Icon name="play" size={12} />
              </button>
              <button
                className="iconbtn-sm"
                title="Remove"
                onClick={() => onRemove?.(i)}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

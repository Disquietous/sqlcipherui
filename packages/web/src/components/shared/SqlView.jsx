import { useState } from 'react';
import { SqlReadOnly } from './SqlEditor';

const cx = (...xs) => xs.filter(Boolean).join(' ');

/**
 * Read-only SQL display with a Formatted / Raw toggle.
 * Defaults to the formatted version when available; falls back to raw.
 */
export function SqlView({ formatted, raw, emptyMessage = '-- No SQL available' }) {
  const hasFormatted = !!formatted;
  const [mode, setMode] = useState(hasFormatted ? 'formatted' : 'raw');
  const effective = mode === 'formatted' && hasFormatted ? 'formatted' : 'raw';
  const sql = effective === 'formatted' ? formatted : (raw || emptyMessage);

  return (
    <div className="sql-view">
      <div className="sql-view-tabs">
        <button
          className={cx('sql-view-tab', effective === 'formatted' && 'is-active')}
          disabled={!hasFormatted}
          title={hasFormatted ? 'Formatted SQL' : 'No formatted version available'}
          onClick={() => setMode('formatted')}
        >
          Formatted
        </button>
        <button
          className={cx('sql-view-tab', effective === 'raw' && 'is-active')}
          title="SQL as stored in sqlite_master"
          onClick={() => setMode('raw')}
        >
          Raw
        </button>
      </div>
      <SqlReadOnly sql={sql} />
    </div>
  );
}

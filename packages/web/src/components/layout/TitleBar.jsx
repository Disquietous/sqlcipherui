import { useState, useCallback } from 'react';
import { Icon } from '../icons/Icon';
import { useUiStore } from '../../stores/ui';
import { useConnectionStore } from '../../stores/connection';
import { DatabaseDropdown } from '../modals/OpenDatabaseModal';

const cx = (...xs) => xs.filter(Boolean).join(' ');

export function TitleBar({ onNeedUnlock, onDisconnect, onCreateNew }) {
  const { mode, setMode, theme, setTheme } = useUiStore();
  const connections = useConnectionStore((s) => s.connections);
  const activeDbId = useConnectionStore((s) => s.activeDbId);
  const activeDb = connections[activeDbId] || null;
  const isConnected = Object.keys(connections).length > 0;
  const isLocked = activeDb?.encrypted && !activeDb?.unlocked;
  const [showDropdown, setShowDropdown] = useState(false);

  const themeIcon = { classic: 'sun', console: 'moon', workbench: 'sunrise' }[theme] || 'sun';
  const cycleTheme = () => {
    const order = ['classic', 'console', 'workbench'];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  };

  const toggleDropdown = useCallback(() => {
    setShowDropdown(prev => !prev);
  }, []);

  const closeDropdown = useCallback(() => {
    setShowDropdown(false);
  }, []);

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <div className="brand">
          <img src="/logo.png" alt="" className="brand-logo" />
          <span>SQLCipherUI</span>
        </div>
        <div className="mode-switch">
          <button
            className={cx('mode-btn', mode === 'ide' && 'is-on')}
            onClick={() => setMode('ide')}
            title="Classic IDE"
          >
            <Icon name="columns" size={11} /><span>IDE</span>
          </button>
          <button
            className={cx('mode-btn', mode === 'canvas' && 'is-on')}
            onClick={() => setMode('canvas')}
            title="Schema designer"
          >
            <Icon name="database" size={11} /><span>Schema designer</span>
          </button>
          <button
            className={cx('mode-btn', mode === 'dataflows' && 'is-on')}
            onClick={() => setMode('dataflows')}
            title="Data Flows"
          >
            <Icon name="merge" size={11} /><span>Data Flows</span>
          </button>
        </div>
      </div>
      <div className="titlebar-center" style={{ position: 'relative' }}>
        {isConnected && activeDb ? (
          <div className="dbpill" title={activeDb.path} onClick={toggleDropdown} style={{ cursor: 'pointer' }}>
            <Icon name={isLocked ? 'lock' : 'unlock'} size={12} />
            <span className="dbpill-name">{activeDb.name || 'No database'}</span>
            <span className="dbpill-sep">·</span>
            <span className="dbpill-mute">{activeDb.encrypted ? 'SQLCipher' : 'SQLite'}</span>
          </div>
        ) : (
          <button className="dbpill" onClick={toggleDropdown} style={{ cursor: 'pointer', border: 'none', background: 'transparent' }}>
            <Icon name="database" size={12} />
            <span className="dbpill-name" style={{ color: 'var(--text-3)' }}>Open database…</span>
          </button>
        )}
        {showDropdown && (
          <DatabaseDropdown onClose={closeDropdown} onNeedUnlock={(connId) => { closeDropdown(); onNeedUnlock(connId); }} onCreateNew={onCreateNew} />
        )}
      </div>
      <div className="titlebar-right">
        {isConnected && (
          <button className="iconbtn" title="Close database" onClick={onDisconnect}>
            <Icon name="close" size={14} />
          </button>
        )}
        <button className="iconbtn" title="Toggle theme" onClick={cycleTheme}>
          <Icon name={themeIcon} size={14} />
        </button>
      </div>
    </div>
  );
}

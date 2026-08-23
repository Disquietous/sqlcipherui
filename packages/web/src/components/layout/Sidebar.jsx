import { useState, useEffect, useCallback } from 'react';
import { useUiStore } from '../../stores/ui';
import { useConnectionStore } from '../../stores/connection';
import { useTabsStore } from '../../stores/tabs';
import { Icon } from '../icons/Icon';
import { getTables, getViews, getIndexes, getTriggers } from '../../api/schema';
import { closeDatabase } from '../../api/database';

const cx = (...xs) => xs.filter(Boolean).join(' ');

export function Sidebar() {
  const activeView = useUiStore((s) => s.activeView);

  if (activeView === 'cipher') return <CipherSidebar />;
  if (activeView === 'settings') return <SettingsSidebar />;
  return <SchemaSidebar />;
}

function SidebarHeader({ title, count, action }) {
  return (
    <div className="sb-header">
      <span className="sb-header-title">{title}</span>
      {count !== undefined && <span className="sb-header-count">{count}</span>}
      <div style={{ flex: 1 }} />
      {action}
    </div>
  );
}

function SchemaSidebar() {
  const connections = useConnectionStore((s) => s.connections);
  const activeDbId = useConnectionStore((s) => s.activeDbId);
  const setActiveDb = useConnectionStore((s) => s.setActiveDb);
  const openTable = useTabsStore((s) => s.openTable);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const removeConnection = useConnectionStore((s) => s.removeConnection);
  const [q, setQ] = useState('');

  const connList = Object.values(connections).filter(c => c.unlocked || !c.encrypted);

  const handleClose = useCallback(async (dbId) => {
    try { await closeDatabase(dbId); } catch { /* ignore */ }
    removeConnection(dbId);
    const { tabs } = useTabsStore.getState();
    const remaining = tabs.filter(t => t.db !== dbId);
    useTabsStore.setState({
      tabs: remaining,
      activeTabId: remaining.length ? remaining[0].id : null,
    });
  }, [removeConnection]);

  return (
    <div className="sb">
      <div className="sb-dbselect">
        <Icon name="database" size={13} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {connList.length} database{connList.length !== 1 ? 's' : ''} open
        </span>
      </div>
      {connList.length > 0 && (
        <div className="sb-search">
          <Icon name="search" size={12} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter schema…" />
          {q && (
            <button className="sb-search-clear" onClick={() => setQ('')}>
              <Icon name="close" size={10} />
            </button>
          )}
        </div>
      )}
      <div className="sb-scroll">
        {connList.length === 0 && (
          <div className="muted small" style={{ padding: 16 }}>No databases connected</div>
        )}
        {connList.map(conn => (
          <DatabaseSchemaSection
            key={conn.path}
            conn={conn}
            isActive={conn.path === activeDbId}
            onActivate={() => setActiveDb(conn.path)}
            onClose={() => handleClose(conn.path)}
            onSelect={(group, name) => {
              setActiveDb(conn.path);
              if (group === 'tables') {
                openTable(name, { db: conn.path });
              } else if (group === 'views') {
                openTable(name, { icon: 'view', kind: 'data', db: conn.path });
              } else if (group === 'indexes') {
                openTable(name, { icon: 'key', kind: 'index', db: conn.path });
              } else if (group === 'triggers') {
                openTable(name, { icon: 'settings', kind: 'trigger', db: conn.path });
              }
              setActiveView('schema');
            }}
            filter={q}
          />
        ))}
      </div>
    </div>
  );
}

function DatabaseSchemaSection({ conn, isActive, onActivate, onClose, onSelect, filter }) {
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const [tables, setTables] = useState([]);
  const [views, setViews] = useState([]);
  const [indexes, setIndexes] = useState([]);
  const [triggers, setTriggers] = useState([]);
  const [expanded, setExpanded] = useState(true);
  const [open, setOpen] = useState({ tables: true, views: true, indexes: false, triggers: false });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [t, v, i, tr] = await Promise.allSettled([
        getTables(conn.path),
        getViews(conn.path),
        getIndexes(conn.path),
        getTriggers(conn.path),
      ]);
      if (cancelled) return;
      if (t.status === 'fulfilled') setTables(t.value);
      if (v.status === 'fulfilled') setViews(v.value);
      if (i.status === 'fulfilled') setIndexes(i.value);
      if (tr.status === 'fulfilled') setTriggers(tr.value);
    }
    load();
    return () => { cancelled = true; };
  }, [conn.path, conn.unlocked]);

  const dbName = conn.name || conn.path.split('/').pop();

  const groups = [
    { name: 'tables', icon: 'table', items: tables, showRows: true },
    { name: 'views', icon: 'view', items: views.map(v => ({ name: v.name })), showRows: false },
    { name: 'indexes', icon: 'key', items: indexes.map(i => ({ name: i.name, meta: i.unique ? 'U' : '' })), showRows: false },
    { name: 'triggers', icon: 'settings', items: triggers.map(t => ({ name: t.name })), showRows: false },
  ];

  const filtered = groups.map(g => ({
    ...g,
    items: filter ? g.items.filter(i => i.name.toLowerCase().includes(filter.toLowerCase())) : g.items,
  }));

  const handleHeaderClick = () => {
    onActivate();
    setExpanded(e => !e);
  };

  return (
    <div className="sb-db-section">
      <div
        className={cx('sb-db-header', isActive && 'is-active')}
        onClick={handleHeaderClick}
      >
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={10} />
        <Icon name="database" size={12} />
        <span className="sb-db-name">{dbName}</span>
        <button
          className="sb-db-close"
          title="Close database"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      {expanded && filtered.map(g => {
        const isOpen = open[g.name];
        return (
          <div key={g.name} className="sb-group">
            <button className="sb-group-h" onClick={() => setOpen({ ...open, [g.name]: !isOpen })}>
              <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={10} />
              <span>{g.name}</span>
              <span className="sb-group-count">{g.items.length}</span>
            </button>
            {isOpen && (
              <div className="sb-items">
                {g.items.length === 0 && (
                  <div style={{ padding: '4px 12px 4px 38px', fontSize: '0.917em', color: 'var(--text-3)' }}>
                    None
                  </div>
                )}
                {g.items.map(it => {
                  const tabId = `${conn.path}::${it.name}`;
                  return (
                    <button
                      key={it.name}
                      className={cx('sb-item', activeTabId === tabId && 'is-selected')}
                      onClick={() => onSelect(g.name, it.name)}
                    >
                      <Icon name={g.icon} size={13} />
                      <span className="sb-item-name">{it.name}</span>
                      {g.showRows && it.row_count !== undefined && (
                        <span className="sb-item-meta">{it.row_count.toLocaleString()}</span>
                      )}
                      {it.meta === 'U' && <span className="sb-tag">U</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CipherSidebar() {
  return (
    <div className="sb">
      <div className="sb-scroll">
        <div className="sb-group">
          <SidebarHeader title="ENCRYPTION" />
          <div className="sb-items">
            <button className="sb-item is-selected"><Icon name="shield" size={13} /><span className="sb-item-name">Encryption management</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsSidebar() {
  return (
    <div className="sb">
      <div className="sb-scroll">
        <div className="sb-group">
          <SidebarHeader title="DATABASE" />
          <div className="sb-items">
            <button className="sb-item is-selected"><Icon name="settings" size={13} /><span className="sb-item-name">PRAGMAs</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}

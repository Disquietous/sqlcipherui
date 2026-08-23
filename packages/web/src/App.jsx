import { useState, useEffect, useCallback } from 'react';
import { useUiStore } from './stores/ui';
import { useConnectionStore } from './stores/connection';
import { useTabsStore } from './stores/tabs';
import { THEMES } from './themes/tokens';
import { TitleBar } from './components/layout/TitleBar';
import { ActivityRail } from './components/layout/ActivityRail';
import { Sidebar } from './components/layout/Sidebar';
import { TabBar } from './components/layout/TabBar';
import { StatusBar } from './components/layout/StatusBar';
import { UnlockModal } from './components/modals/UnlockModal';
import { CreateDatabaseModal } from './components/modals/CreateDatabaseModal';
import { DashboardPanel } from './components/panels/DashboardPanel';
import { DataPanel } from './components/panels/DataPanel';
import { QueryPanel } from './components/panels/QueryPanel';
import { HistoryPanel } from './components/panels/HistoryPanel';
import { CipherPanel } from './components/panels/CipherPanel';
import { SettingsPanel } from './components/panels/SettingsPanel';
import { SchemaDetailPanel } from './components/panels/SchemaDetailPanel';
import { CanvasMode } from './components/canvas/CanvasMode';
import { DataFlowsMode } from './components/dataflows/DataFlowsMode';
import { Icon } from './components/icons/Icon';
import { useHistoryStore } from './stores/history';
import { useSavedStore } from './stores/saved';
import { closeDatabase, getConnections } from './api/database';

import './themes/index.css';

const cx = (...xs) => xs.filter(Boolean).join(' ');

export default function App() {
  const { theme: themeName, mode, activeView, setActiveView } = useUiStore();
  const connections = useConnectionStore((s) => s.connections);
  const activeDbId = useConnectionStore((s) => s.activeDbId);
  const { tabs, activeTabId } = useTabsStore();
  const theme = THEMES[themeName] || THEMES.classic;

  const isConnected = Object.keys(connections).length > 0;

  const [unlockConnId, setUnlockConnId] = useState(null);
  const [showCreateDb, setShowCreateDb] = useState(false);
  const historyEntries = useHistoryStore((s) => s.entries);
  const addConnection = useConnectionStore((s) => s.addConnection);

  useEffect(() => {
    getConnections()
      .then((conns) => {
        if (Array.isArray(conns)) {
          for (const info of conns) {
            addConnection(info);
          }
        }
      })
      .catch(() => {});
    useHistoryStore.getState().loadHistory();
    useSavedStore.getState().load();
    useUiStore.getState().loadSettings();
  }, []);

  const rootStyle = {
    ...theme.vars,
    '--font-ui': theme.fontUI,
    '--font-mono': theme.fontMono,
    fontFamily: theme.fontUI,
    color: 'var(--text)',
    background: 'var(--bg)',
  };

  const handleNeedUnlock = (connId) => setUnlockConnId(connId);
  const handleCloseUnlock = () => setUnlockConnId(null);

  const handleDisconnect = useCallback(async () => {
    if (!activeDbId) return;
    try {
      await closeDatabase(activeDbId);
    } catch { /* ignore */ }
    useConnectionStore.getState().removeConnection(activeDbId);
    // Close tabs that belong to the disconnected database
    const { tabs } = useTabsStore.getState();
    const remaining = tabs.filter(t => t.db !== activeDbId);
    useTabsStore.setState({
      tabs: remaining,
      activeTabId: remaining.length ? remaining[0].id : null,
    });
  }, [activeDbId]);

  const activeTab = tabs.find(t => t.id === activeTabId);

  let mainPanel;
  if (!isConnected) {
    mainPanel = (
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Icon name="database" size={48} stroke={1} style={{ color: 'var(--text-3)', opacity: 0.3 }} />
        <div style={{ color: 'var(--text-3)', fontSize: '1.077em' }}>No database connected</div>
        <div style={{ color: 'var(--text-3)', fontSize: '0.923em' }}>Click the database button above to open a database</div>
      </div>
    );
  } else if (activeView === 'dashboard') {
    mainPanel = <DashboardPanel />;
  } else if (activeView === 'query') {
    mainPanel = <QueryPanel />;
  } else if (activeView === 'history') {
    mainPanel = <HistoryPanel history={historyEntries} onRunQuery={(sql) => { useUiStore.getState().setPendingSQL(sql); setActiveView('query'); }} onRemove={(i) => useHistoryStore.getState().removeEntry(i)} />;
  } else if (activeView === 'cipher') {
    mainPanel = <CipherPanel />;
  } else if (activeView === 'settings') {
    mainPanel = <SettingsPanel />;
  } else if (activeTab?.kind === 'query') {
    mainPanel = <QueryPanel />;
  } else if (activeTab?.kind === 'data') {
    mainPanel = <DataPanel table={activeTab.title} db={activeTab.db} />;
  } else if (activeTab?.kind === 'index' || activeTab?.kind === 'trigger') {
    mainPanel = <SchemaDetailPanel name={activeTab.title} kind={activeTab.kind} db={activeTab.db} />;
  } else if (isConnected) {
    mainPanel = (
      <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: '1em' }}>
        Select a table from the sidebar to browse data.
      </div>
    );
  }

  const showTabs = activeView === 'schema' && isConnected;

  return (
    <div className={cx('sqlui', mode === 'canvas' && 'cv', `sqlui-${theme.mode}`)} style={rootStyle}>
      <TitleBar onNeedUnlock={handleNeedUnlock} onDisconnect={handleDisconnect} onCreateNew={() => setShowCreateDb(true)} />
      {mode === 'dataflows' ? (
        <DataFlowsMode />
      ) : mode === 'canvas' ? (
        <CanvasMode onDisconnect={handleDisconnect} />
      ) : (
        <div className="body">
          <ActivityRail />
          {!['dashboard', 'query', 'history'].includes(activeView) && <Sidebar />}
          <div className="main">
            {showTabs && <TabBar />}
            <div className="content">{mainPanel}</div>
            <StatusBar />
          </div>
        </div>
      )}
      {unlockConnId && <UnlockModal connId={unlockConnId} onClose={handleCloseUnlock} />}
      {showCreateDb && <CreateDatabaseModal onClose={() => setShowCreateDb(false)} />}
    </div>
  );
}

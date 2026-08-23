import { create } from 'zustand';

export const useTabsStore = create((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTable: (name, opts = {}) => {
    const { tabs } = get();
    const icon = opts.icon || 'table';
    const kind = opts.kind || 'data';
    const db = opts.db || null;
    const id = db ? `${db}::${name}` : name;
    if (!tabs.find((t) => t.id === id)) {
      set({
        tabs: [...tabs, { id, icon, title: name, dirty: false, kind, db }],
        activeTabId: id,
      });
    } else {
      set({ activeTabId: id });
    }
  },

  openQuery: (id) => {
    const qid = id || `query-${Date.now()}`;
    const { tabs } = get();
    set({
      tabs: [...tabs, { id: qid, icon: 'terminal', title: 'Query.sql', dirty: false, kind: 'query' }],
      activeTabId: qid,
    });
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    const next = tabs.filter((t) => t.id !== id);
    set({
      tabs: next,
      activeTabId: activeTabId === id && next.length ? next[0].id : activeTabId,
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),
}));

import { create } from 'zustand';
import { getHistory as fetchHistory, addHistory as postHistory, removeHistory as deleteHistory, clearHistory as clearAll } from '../api/app';

export const useHistoryStore = create((set, get) => ({
  entries: [],
  loaded: false,

  loadHistory: async () => {
    try {
      const raw = await fetchHistory(200);
      const entries = raw.map(r => ({
        id: r.id,
        sql: r.sql_text,
        row_count: r.row_count,
        elapsed_ms: r.elapsed_ms,
        error: r.error,
        ts: r.created_at?.replace('T', ' ').slice(11, 19) || '',
        _ts: r.created_at ? new Date(r.created_at + 'Z').getTime() : Date.now(),
      }));
      set({ entries, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  addEntry: async (entry) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const local = { ...entry, ts, _ts: Date.now() };

    set({ entries: [local, ...get().entries].slice(0, 200) });

    try {
      const res = await postHistory({
        sql_text: entry.sql,
        row_count: entry.row_count || 0,
        elapsed_ms: entry.elapsed_ms || 0,
        error: entry.error || null,
      });
      local.id = res.id;
      set({ entries: [local, ...get().entries.slice(1)] });
    } catch {}
  },

  removeEntry: async (index) => {
    const entries = get().entries;
    const entry = entries[index];
    set({ entries: entries.filter((_, i) => i !== index) });
    if (entry?.id) {
      try { await deleteHistory(entry.id); } catch {}
    }
  },

  clear: async () => {
    set({ entries: [] });
    try { await clearAll(); } catch {}
  },
}));

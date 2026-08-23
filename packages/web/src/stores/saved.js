import { create } from 'zustand';
import { getSavedQueries, saveQuery as postSave, updateSavedQuery, deleteSavedQuery } from '../api/app';

export const useSavedStore = create((set, get) => ({
  queries: [],
  loaded: false,

  load: async () => {
    try {
      const queries = await getSavedQueries();
      set({ queries, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  save: async (name, sql_text, description = '') => {
    try {
      const res = await postSave(name, sql_text, description);
      set({ queries: [res, ...get().queries] });
      return res;
    } catch {}
  },

  update: async (id, updates) => {
    try {
      await updateSavedQuery(id, updates);
      set({ queries: get().queries.map(q => q.id === id ? { ...q, ...updates } : q) });
    } catch {}
  },

  remove: async (id) => {
    set({ queries: get().queries.filter(q => q.id !== id) });
    try { await deleteSavedQuery(id); } catch {}
  },
}));

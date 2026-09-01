import { create } from 'zustand';
import { getCompletionSnapshot } from '../api/schema';
import { buildIndex } from '../completion/index';
import { useConnectionStore } from './connection';

/**
 * Per-database completion snapshot + prebuilt index.
 *
 * snapshots[db] = { etag, index, loading, error, dirty }
 * Consumers should read the index via getIndex(db) inside the completion
 * source (no React re-render needed when it refreshes).
 */
export const useSchemaStore = create((set, get) => ({
  snapshots: {},

  getIndex: (db) => {
    const s = get().snapshots[db];
    return s ? s.index : null;
  },

  loadSchema: async (db) => {
    if (!db) return;
    const cur = get().snapshots[db];
    if (cur && cur.loading) { patch(set, db, { dirty: true }); return; }
    patch(set, db, { loading: true, dirty: false, error: null });
    try {
      const res = await getCompletionSnapshot(db, cur && cur.etag);
      if (res.notModified) {
        patch(set, db, { loading: false });
      } else {
        const index = buildIndex(res.data);
        patch(set, db, { loading: false, etag: res.etag, index, error: null });
      }
    } catch (err) {
      patch(set, db, { loading: false, error: err.message || String(err) });
    }
    if (get().snapshots[db] && get().snapshots[db].dirty) get().loadSchema(db);
  },

  invalidate: (db) => get().loadSchema(db),

  invalidateAll: () => {
    for (const db of Object.keys(get().snapshots)) get().loadSchema(db);
  },

  forget: (db) => set((s) => {
    const rest = { ...s.snapshots };
    delete rest[db];
    return { snapshots: rest };
  }),
}));

function patch(set, db, fields) {
  set((s) => ({ snapshots: { ...s.snapshots, [db]: { ...(s.snapshots[db] || {}), ...fields } } }));
}

// --- Invalidation hooks --------------------------------------------------

if (typeof window !== 'undefined') {
  window.addEventListener('sqlui:schema-changed', (e) => {
    const db = e.detail && e.detail.db;
    if (db && useSchemaStore.getState().snapshots[db]) useSchemaStore.getState().invalidate(db);
  });
  // Cheap 304 revalidation when the user comes back to the window.
  window.addEventListener('focus', () => useSchemaStore.getState().invalidateAll());
}

// Reload when a database becomes unlocked; drop when it is closed.
useConnectionStore.subscribe((state, prev) => {
  const store = useSchemaStore.getState();
  for (const id of Object.keys(state.connections)) {
    const was = prev.connections[id];
    const now = state.connections[id];
    if (now && (!was || (!was.unlocked && now.unlocked)) && store.snapshots[id]) store.invalidate(id);
  }
  for (const id of Object.keys(prev.connections)) {
    if (!state.connections[id] && store.snapshots[id]) store.forget(id);
  }
});

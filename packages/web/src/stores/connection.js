import { create } from 'zustand';

export const useConnectionStore = create((set, get) => ({
  connections: {},
  activeDbId: null,

  addConnection: (info) => set((s) => ({
    connections: { ...s.connections, [info.path]: info },
    activeDbId: info.path,
  })),

  removeConnection: (id) => set((s) => {
    const { [id]: _, ...rest } = s.connections;
    return {
      connections: rest,
      activeDbId: s.activeDbId === id ? (Object.keys(rest)[0] || null) : s.activeDbId,
    };
  }),

  updateConnection: (id, updates) => set((s) => ({
    connections: {
      ...s.connections,
      [id]: { ...s.connections[id], ...updates },
    },
  })),

  setActiveDb: (id) => set({ activeDbId: id }),
}));

import { create } from 'zustand';
import { getSettings, setSetting } from '../api/app';

const saved = (() => {
  try {
    const raw = localStorage.getItem('sqlui-prefs');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
})();

export const useUiStore = create((set, get) => ({
  theme: saved.theme || 'classic',
  density: saved.density || 'comfortable',
  mode: 'ide',
  activeView: 'schema',
  pendingSQL: null,

  loadSettings: async () => {
    try {
      const settings = await getSettings();
      const patch = {};
      if (settings.theme) patch.theme = settings.theme;
      if (settings.density) patch.density = settings.density;
      if (Object.keys(patch).length) {
        set(patch);
        persistLocal(get());
      }
    } catch {}
  },

  setTheme: (theme) => {
    set({ theme });
    persistLocal(get());
    setSetting('theme', theme).catch(() => {});
  },
  setDensity: (density) => {
    set({ density });
    persistLocal(get());
    setSetting('density', density).catch(() => {});
  },
  setMode: (mode) => set({ mode }),
  setActiveView: (activeView) => set({ activeView }),
  setPendingSQL: (sql) => set({ pendingSQL: sql }),
}));

function persistLocal(state) {
  try {
    localStorage.setItem('sqlui-prefs', JSON.stringify({
      theme: state.theme,
      density: state.density,
    }));
  } catch {}
}

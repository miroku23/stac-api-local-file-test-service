export default {
  state: () => ({
    shortcutsStorageKey: "file-manage:desktop-shortcuts",
    shortcuts: []
  }),
  getters: {
    shortcuts: (state) => state.shortcuts
  },
  mutations: {
    setShortcuts(state, shortcuts) {
      state.shortcuts = shortcuts;
    }
  },
  actions: {
    persistShortcuts({ state }) {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(state.shortcutsStorageKey, JSON.stringify(state.shortcuts));
    },
    loadShortcuts({ state, commit }) {
      if (typeof window === "undefined") return;
      try {
        const raw = window.localStorage.getItem(state.shortcutsStorageKey);
        commit("setShortcuts", raw ? JSON.parse(raw) : []);
      } catch {
        commit("setShortcuts", []);
      }
    },
    addShortcut({ state, commit, dispatch }, row) {
      if (!row || row.type !== "folder") return;
      const shortcut = {
        key: `shortcut:${row.path}`,
        label: row.name,
        path: row.path
      };
      if (state.shortcuts.some((item) => item.path === shortcut.path)) return;
      commit("setShortcuts", [...state.shortcuts, shortcut]);
      dispatch("persistShortcuts");
    },
    deleteShortcut({ state, commit, dispatch }, path) {
      commit("setShortcuts", state.shortcuts.filter((item) => item.path !== path));
      dispatch("persistShortcuts");
    }
  }
};

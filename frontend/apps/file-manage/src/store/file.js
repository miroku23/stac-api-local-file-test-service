export default {
  state: () => ({
    shortcutsStorageKey: "file-manage:desktop-shortcuts",
    filePickerTargetKey: "",
    storagePickerTargetKey: "",
    filePickerSelections: {},
    storageFolderSelections: {},
    shortcuts: []
  }),
  getters: {
    filePickerTargetKey: (state) => state.filePickerTargetKey,
    shortcuts: (state) => state.shortcuts,
    storagePickerTargetKey: (state) => state.storagePickerTargetKey
  },
  mutations: {
    setShortcuts(state, shortcuts) {
      state.shortcuts = shortcuts;
    },
    setFilePickerTargetKey(state, key) {
      state.filePickerTargetKey = key;
    },
    setStoragePickerTargetKey(state, key) {
      state.storagePickerTargetKey = key;
    },
    setFilePickerSelections(state, selections) {
      state.filePickerSelections = selections;
    },
    setStorageFolderSelections(state, selections) {
      state.storageFolderSelections = selections;
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
    },
    setFilePickerSelection({ state, commit }, { key, file }) {
      commit("setFilePickerSelections", { ...state.filePickerSelections, [key]: file });
    },
    clearFilePickerSelection({ state, commit }, key) {
      const next = { ...state.filePickerSelections };
      delete next[key];
      commit("setFilePickerSelections", next);
    },
    setStorageFolderSelection({ state, commit }, { key, folder }) {
      commit("setStorageFolderSelections", { ...state.storageFolderSelections, [key]: folder });
    },
    clearStorageFolderSelection({ state, commit }, key) {
      const next = { ...state.storageFolderSelections };
      delete next[key];
      commit("setStorageFolderSelections", next);
    }
  }
};

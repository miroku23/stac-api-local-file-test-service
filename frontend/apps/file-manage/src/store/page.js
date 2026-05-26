import { languageOptions, messages, resolveBrowserLanguage } from "../i18n";

export default {
  state: () => ({
    language: "en",
    dateLocales: {
      ko: "ko-KR",
      en: "en-US"
    },
    languageOptions,
    languageStorageKey: "zarr-file-manage-language",
    desktopIconStorageKey: "zarr-file-manage-desktop-icon-positions",
    desktopIconPositions: {},
    messagesByLanguage: messages,
    activeView: "fileview",
    windows: [
      {
        key: "downloads",
        label: "Downloads",
        icon: "cloud_download",
        description: "Run weather, ocean, and satellite data requests.",
        x: 72,
        y: 48,
        width: 1160,
        height: 720,
        zIndex: 19,
        closed: true,
        minimized: false,
        maximized: false
      },
      {
        key: "fileview",
        type: "fileview",
        label: "FileView",
        icon: "quick_reference_all",
        description: "Inspect files and conversion details.",
        x: 22,
        y: 20,
        width: 980,
        height: 640,
        zIndex: 18,
        closed: true,
        minimized: false,
        maximized: false,
        filePath: "",
        fileRoot: "data",
        message: "",
        loading: false
      },
      {
        key: "fileconvert",
        type: "fileconvert",
        label: "FileConvert",
        icon: "sync_alt",
        description: "Resample files and convert products to Zarr.",
        x: 48,
        y: 42,
        width: 980,
        height: 640,
        zIndex: 17,
        closed: true,
        minimized: false,
        maximized: false,
        filePath: "",
        fileRoot: "data",
        message: "",
        loading: false
      }
    ],
    focusedWindow: "",
    nextZIndex: 20,
    nextFileViewId: 1,
    nextFileConvertId: 1,
    nextFolderId: 1,
    lastCreatedWindowKey: ""
  }),
  getters: {
    activeView: (state) => state.activeView,
    dockWindows: (state) => state.windows.filter((item) => new Set(["downloads", "fileview", "fileconvert"]).has(item.key)),
    desktopIconPositions: (state) => state.desktopIconPositions,
    focusedWindow: (state) => state.focusedWindow,
    language: (state) => state.language,
    dateLocale: (state) => state.dateLocales[state.language] || state.dateLocales.en,
    languageOptions: (state) => state.languageOptions,
    messages: (state) => state.messagesByLanguage[state.language] || state.messagesByLanguage.en,
    primeVueLocale: (state, getters) => getters.messages.primevue,
    windows: (state) => state.windows
  },
  mutations: {
    setLanguage(state, language) {
      state.language = language;
    },
    setActiveView(state, view) {
      state.activeView = view;
    },
    setDesktopIconPositions(state, positions) {
      state.desktopIconPositions = positions;
    },
    setFocusedWindow(state, key) {
      state.focusedWindow = key;
    },
    setWindows(state, windows) {
      state.windows = windows;
    },
    setNextZIndex(state, value) {
      state.nextZIndex = value;
    },
    setNextFileViewId(state, value) {
      state.nextFileViewId = value;
    },
    setNextFileConvertId(state, value) {
      state.nextFileConvertId = value;
    },
    setNextFolderId(state, value) {
      state.nextFolderId = value;
    },
    setLastCreatedWindowKey(state, key) {
      state.lastCreatedWindowKey = key;
    }
  },
  actions: {
    initializeLanguage({ state, dispatch }) {
      const savedLanguage = globalThis.localStorage?.getItem(state.languageStorageKey);
      const browserLanguage = resolveBrowserLanguage();
      dispatch("setLanguage", savedLanguage || browserLanguage);
    },
    setLanguage({ state, commit }, language) {
      const nextLanguage = state.messagesByLanguage[language] ? language : "en";
      commit("setLanguage", nextLanguage);
      globalThis.localStorage?.setItem(state.languageStorageKey, nextLanguage);
    },
    loadDesktopIconPositions({ state, commit }) {
      if (typeof window === "undefined") return;
      try {
        const raw = window.localStorage.getItem(state.desktopIconStorageKey);
        commit("setDesktopIconPositions", raw ? JSON.parse(raw) : {});
      } catch {
        commit("setDesktopIconPositions", {});
      }
    },
    persistDesktopIconPositions({ state }) {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(state.desktopIconStorageKey, JSON.stringify(state.desktopIconPositions));
    },
    setDesktopIconPosition({ state, commit, dispatch }, { key, position }) {
      if (!key || !position) return;
      commit("setDesktopIconPositions", {
        ...state.desktopIconPositions,
        [key]: {
          x: Number(position.x) || 0,
          y: Number(position.y) || 0
        }
      });
      dispatch("persistDesktopIconPositions");
    },
    setDesktopIconGridPosition({ state, commit, dispatch }, { key, grid }) {
      if (!key) return;
      const [col = 0, row = 0] = Array.isArray(grid) ? grid : [];
      commit("setDesktopIconPositions", {
        ...state.desktopIconPositions,
        [key]: {
          grid: [Math.max(0, Number(col) || 0), Math.max(0, Number(row) || 0)]
        }
      });
      dispatch("persistDesktopIconPositions");
    },
    setDesktopIconPositions({ commit, dispatch }, positions) {
      commit("setDesktopIconPositions", positions || {});
      dispatch("persistDesktopIconPositions");
    },
    patchWindow({ state, commit }, { key, patch }) {
      commit("setWindows", state.windows.map((item) => (item.key === key ? { ...item, ...patch } : item)));
    },
    focusWindow({ state, commit, dispatch }, key) {
      const windowItem = state.windows.find((item) => item.key === key);
      if (!windowItem) return;
      const nextZIndex = state.nextZIndex + 1;
      commit("setNextZIndex", nextZIndex);
      commit("setFocusedWindow", key);
      commit("setActiveView", key);
      dispatch("patchWindow", { key, patch: { zIndex: nextZIndex } });
    },
    setWindowOpenState({ dispatch }, { key, closed, minimized }) {
      dispatch("patchWindow", { key, patch: { closed, minimized } });
    },
    openWindow({ state, dispatch }, key) {
      const windowItem = state.windows.find((item) => item.key === key);
      if (!windowItem) return;
      const patch = { closed: false, minimized: false };
      if (windowItem.key === "fileview" && windowItem.closed) {
        Object.assign(patch, {
          filePath: "",
          fileRoot: "data",
          label: "FileView",
          description: "Inspect files and conversion details.",
          message: ""
        });
      }
      if (windowItem.key === "fileconvert" && windowItem.closed) {
        Object.assign(patch, {
          filePath: "",
          fileRoot: "data",
          label: "FileConvert",
          description: "Resample files and convert products to Zarr.",
          message: ""
        });
      }
      dispatch("patchWindow", { key, patch });
    },
    closeWindow({ dispatch }, key) {
      dispatch("patchWindow", { key, patch: { closed: true } });
    },
    minimizeWindow({ dispatch }, key) {
      dispatch("patchWindow", { key, patch: { minimized: true } });
    },
    toggleMaximize({ state, dispatch }, key) {
      const windowItem = state.windows.find((item) => item.key === key);
      if (!windowItem) return;
      dispatch("patchWindow", { key, patch: { maximized: !windowItem.maximized } });
    },
    createFolderWindow({ state, commit }, options = {}) {
      const id = state.nextFolderId;
      const offset = id % 6;
      const zIndex = state.nextZIndex + 1;
      const windowItem = {
        key: `folder-${id}`,
        type: "folder",
        label: options.label || state.messagesByLanguage[state.language]?.common.folder || "Folder",
        icon: "folder",
        description: options.description || "Browse DATA_ROOT_DIR folders and files.",
        x: 72 + offset * 24,
        y: 38 + offset * 24,
        width: 980,
        height: 640,
        zIndex,
        closed: true,
        minimized: false,
        maximized: false,
        initialPath: options.initialPath || ""
      };
      commit("setNextFolderId", id + 1);
      commit("setNextZIndex", zIndex);
      commit("setWindows", [...state.windows, windowItem]);
      commit("setLastCreatedWindowKey", windowItem.key);
    },
    createFileViewWindow({ state, commit }, row) {
      const id = state.nextFileViewId;
      const fileName = row.name || row.path.split("/").pop() || "FileView";
      const zIndex = state.nextZIndex + 1;
      const windowItem = {
        key: `fileview-${id}`,
        type: "fileview",
        label: fileName,
        icon: "quick_reference_all",
        description: row.path,
        x: 260 + (id % 5) * 24,
        y: 76 + (id % 5) * 24,
        width: 980,
        height: 640,
        zIndex,
        closed: true,
        minimized: false,
        maximized: false,
        filePath: row.path,
        fileRoot: row.root || "data",
        message: "",
        loading: false
      };
      commit("setNextFileViewId", id + 1);
      commit("setNextZIndex", zIndex);
      commit("setWindows", [...state.windows, windowItem]);
      commit("setLastCreatedWindowKey", windowItem.key);
    },
    createFileConvertWindow({ state, commit }, row = {}) {
      const id = state.nextFileConvertId;
      const path = row?.path || "";
      const fileName = row?.name || path.split("/").pop() || "FileConvert";
      const zIndex = state.nextZIndex + 1;
      const windowItem = {
        key: `fileconvert-${id}`,
        type: "fileconvert",
        label: path ? fileName : "FileConvert",
        icon: "sync_alt",
        description: path || "Resample files and convert products to Zarr.",
        x: 286 + (id % 5) * 24,
        y: 92 + (id % 5) * 24,
        width: 980,
        height: 640,
        zIndex,
        closed: true,
        minimized: false,
        maximized: false,
        filePath: path,
        fileRoot: row?.root || "data",
        message: "",
        loading: false
      };
      commit("setNextFileConvertId", id + 1);
      commit("setNextZIndex", zIndex);
      commit("setWindows", [...state.windows, windowItem]);
      commit("setLastCreatedWindowKey", windowItem.key);
    },
    setFileViewFile({ dispatch }, { key, row }) {
      const path = row?.path || "";
      const fileName = row?.name || path.split("/").pop() || "FileView";
      dispatch("patchWindow", {
        key,
        patch: {
          filePath: path,
          fileRoot: row?.root || "data",
          label: path ? fileName : "FileView",
          description: path || "Inspect files and conversion details.",
          message: ""
        }
      });
    },
    setFileConvertFile({ dispatch }, { key, row }) {
      const path = row?.path || "";
      const fileName = row?.name || path.split("/").pop() || "FileConvert";
      dispatch("patchWindow", {
        key,
        patch: {
          filePath: path,
          fileRoot: row?.root || "data",
          label: path ? fileName : "FileConvert",
          description: path || "Resample files and convert products to Zarr.",
          message: ""
        }
      });
    },
    closeWindowItem({ state, rootState, commit, dispatch }, key) {
      const windowItem = state.windows.find((item) => item.key === key);
      if (windowItem?.type === "fileview" && windowItem.filePath) {
        dispatch("setFileViewFile", { key, row: { path: "", root: "data" } });
      }
      if (windowItem?.type === "fileconvert" && windowItem.filePath) {
        dispatch("setFileConvertFile", { key, row: { path: "", root: "data" } });
      }
      if (rootState.file.filePickerTargetKey === key) commit("setFilePickerTargetKey", "");
      if (rootState.file.storagePickerTargetKey === key) commit("setStoragePickerTargetKey", "");
      dispatch("closeWindow", key);
      dispatch("focusTopVisibleWindow");
    },
    focusTopVisibleWindow({ state, commit }) {
      const visibleWindows = state.windows.filter((item) => !item.closed && !item.minimized);
      if (!visibleWindows.length) {
        commit("setFocusedWindow", "");
        return "";
      }
      const topWindow = visibleWindows.reduce((top, item) => (item.zIndex > top.zIndex ? item : top));
      commit("setFocusedWindow", topWindow.key);
      commit("setActiveView", topWindow.key);
      return topWindow.key;
    }
  }
};

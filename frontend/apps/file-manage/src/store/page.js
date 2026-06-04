import { getMessage, languageOptions, messageCodes, messages, resolveBrowserLanguage } from "../i18n";

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
    messageCodesByLanguage: messageCodes
  }),
  getters: {
    dateLocale: (state) => state.dateLocales[state.language] || state.dateLocales.en,
    desktopIconPositions: (state) => state.desktopIconPositions,
    language: (state) => state.language,
    languageOptions: (state) => state.languageOptions,
    messageCodes: (state) => state.messageCodesByLanguage[state.language] || state.messageCodesByLanguage.en,
    messageCode: (state, getters) => (code, options) => getMessage(getters.messageCodes, code, options),
    messages: (state) => state.messagesByLanguage[state.language] || state.messagesByLanguage.en,
    primeVueLocale: (state, getters) => getters.messages.primevue
  },
  mutations: {
    setDesktopIconPositions(state, positions) {
      state.desktopIconPositions = positions;
    },
    setLanguage(state, language) {
      state.language = language;
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
    setDesktopIconPositions({ commit, dispatch }, positions) {
      commit("setDesktopIconPositions", positions || {});
      dispatch("persistDesktopIconPositions");
    }
  }
};

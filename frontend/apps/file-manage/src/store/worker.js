export default {
  state: () => ({
    conversionJobs: [],
    lastDownload: null,
    notifications: [],
    maxConversionJobs: 5,
    conversionJobTitles: {}
  }),
  getters: {
    conversionJobs: (state) => state.conversionJobs,
    lastDownload: (state) => state.lastDownload,
    notifications: (state) => state.notifications
  },
  mutations: {
    setLastDownload(state, payload) {
      state.lastDownload = payload;
    },
    setConversionJobs(state, jobs) {
      state.conversionJobs = jobs;
    },
    setNotifications(state, notifications) {
      state.notifications = notifications;
    }
  },
  actions: {
    normalizeConversionJob({ state, rootGetters }, job = {}) {
      const messages = rootGetters.messages;
      const conversionJobTitles = Object.keys(state.conversionJobTitles).length ? state.conversionJobTitles : messages.worker.zarrTitle;
      const status = job.status || "running";
      const filePath = String(job.file_path || "");
      const fileName = job.fileName || job.file_name || filePath.replace(/\\/g, "/").split("/").pop() || messages.common.selectedFile;
      const progress = Number(job.progress);
      return {
        ...job,
        id: job.id,
        status,
        title: job.title || conversionJobTitles[status] || conversionJobTitles.running,
        fileName,
        message: job.message || job.error || "",
        progress: Number.isFinite(progress) ? progress : null,
        createdAt: job.createdAt || job.created_at || null,
        startedAt: job.startedAt || job.started_at || null,
        updatedAt: job.updatedAt || job.updated_at || null,
        result: job.result || null,
        error: job.error || null
      };
    },
    async upsertConversionJob({ state, rootGetters, commit, dispatch }, job) {
      const index = state.conversionJobs.findIndex((item) => item.id === job.id);
      const conversionJobTitles = Object.keys(state.conversionJobTitles).length ? state.conversionJobTitles : rootGetters.messages.worker.zarrTitle;
      const nextJob = await dispatch("normalizeConversionJob", {
        status: "running",
        title: conversionJobTitles.running,
        message: "",
        progress: null,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        ...job
      });
      if (index >= 0) {
        const jobs = [...state.conversionJobs];
        jobs.splice(index, 1, {
          ...state.conversionJobs[index],
          ...nextJob,
          updatedAt: Date.now()
        });
        commit("setConversionJobs", jobs);
        return;
      }
      commit("setConversionJobs", [nextJob, ...state.conversionJobs].slice(0, state.maxConversionJobs));
    },
    removeConversionJob({ state, commit }, id) {
      commit("setConversionJobs", state.conversionJobs.filter((item) => item.id !== id));
    },
    dismissConversionJob({ dispatch }, id) {
      if (!id) return;
      dispatch("removeConversionJob", id);
    },
    async replaceConversionJobs({ state, commit, dispatch }, jobs) {
      if (!Array.isArray(jobs)) {
        commit("setConversionJobs", []);
        return;
      }
      const normalized = await Promise.all(jobs.map((job) => dispatch("normalizeConversionJob", job)));
      commit("setConversionJobs", normalized.slice(0, state.maxConversionJobs));
    },
    pushNotification({ state, commit }, notification) {
      commit("setNotifications", [
        ...state.notifications,
        {
          id: Date.now(),
          type: "info",
          ...notification
        }
      ]);
    },
    clearNotifications({ commit }) {
      commit("setNotifications", []);
    }
  }
};

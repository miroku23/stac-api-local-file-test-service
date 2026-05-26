import { createStore } from "vuex";
import { logModule } from "./log.js";
import { zarrModule } from "./zarr.js";

function statusLabel(value, pageReady) {
  if (/fail|error|no data/i.test(value || "")) return "오류";
  return pageReady ? "정상" : "준비중";
}

export const store = createStore({
  modules: {
    logs: logModule,
    zarr: zarrModule
  },
  state: () => ({
    dataBaseUrl: "",
    overlayVisible: true,
    rendering: {
      projection: "geoOrthographic",
      basemap: "none",
      datetime: "2026-04-28T18:00",
      timeMode: "local",
      date: "2026-04-28",
      hour: "18",
      flowKind: "none",
      overlay: "none",
      product: "none",
      satelliteKinds: [],
      satelliteColors: {},
      satelliteTimestamp: "2026-04-28T18:00",
      satelliteOrbitHours: 3,
      satelliteVisible: false,
      timelineInteracting: false,
      timelinePreviewDatetime: null,
      coastVisible: true,
      gridVisible: true,
      nightBoundaryVisible: false,
      timezoneVisible: false,
      animationEnabled: true,
      particlesScale: 1,
      fade: 0.01,
      alpha: 0.2,
      tone: 0.45,
      curve: 1,
      overlayAlpha: 0.31,
      overlayColorbar: null,
      productColorbar: null,
      overlayRange: null
    },
    renderConfig: {
      projectionMode: {
        geoOrthographic: 0,
        geoMercator: 1,
        geoEquirectangular: 2,
        geoNaturalEarth1: 3
      },
      particles: {
        min: 2500,
        base: 5000,
        max: 16000,
        currentMax: 9000
      },
      d3View: {
        orthographicRotate: [-127.5, -37.5, 0],
        fitPadding: 8,
        maxDevicePixelRatio: 1.25,
        minVisualWidth: 320,
        minVisualHeight: 180,
        visualScale: 1
      }
    },
    pageReady: false,
    statusRaw: "booting",
    error: "",
    webglInfo: "checking",
    gpuInfo: "checking",
    performance: {
      fps: "0.0",
      frameMs: "0.00"
    },
    viewMetrics: {
      zoom: "1.00x",
      scale: "-",
      resolution: "-"
    },
    layerInfo: {
      fileName: ".zarr",
      shape: "-"
    },
    readout: {
      visible: false,
      markerVisible: false,
      markerX: 0,
      markerY: 0,
      value: "click map for values"
    },
    panels: {
      statusPanel: false,
      layerPanel: false,
      mapSettingsPanel: false,
      logPanel: false
    }
  }),
  getters: {
    viewerState: (state) => state,
    rendering: (state) => state.rendering,
    renderConfig: (state) => state.renderConfig,
    projectionMode: (state) => state.renderConfig.projectionMode,
    particlesConfig: (state) => state.renderConfig.particles,
    d3ViewConfig: (state) => state.renderConfig.d3View,
    statusLabel: (state) => statusLabel(state.statusRaw, state.pageReady),
    panelCollapsed: (state) => (panelId) => Boolean(state.panels[panelId]),
    selectedStamp: (state) => {
      const value = state.rendering.datetime || state.rendering.satelliteTimestamp || "2026-04-28T18:00";
      const [datePart, timePart = "18:00"] = value.split("T");
      const [yyyy = "2026", mm = "04", dd = "28"] = (datePart || "2026-04-28").split("-");
      const [hour = "18", minute = "00"] = timePart.split(":");
      return { yyyy, mm, dd, yyyymm: `${yyyy}${mm}`, yyyymmdd: `${yyyy}${mm}${dd}`, hour, minute };
    },
    selectedFlowKind: (state) => state.rendering.flowKind || "WIND"
  },
  mutations: {
    setDataBaseUrl(state, url) {
      state.dataBaseUrl = (url || "").replace(/\/$/, "");
    },
    setOverlayVisible(state, visible) {
      state.overlayVisible = Boolean(visible);
    },
    setRenderingOption(state, { key, value }) {
      if (!Object.prototype.hasOwnProperty.call(state.rendering, key)) return;
      state.rendering[key] = value;
      if (key === "datetime" && typeof value === "string") {
        const [date, time = ""] = value.split("T");
        const [hour = "00"] = time.split(":");
        state.rendering.date = date || state.rendering.date;
        state.rendering.hour = hour;
        state.rendering.satelliteTimestamp = value;
      }
    },
    setProjection(state, projection) {
      state.rendering.projection = projection || "geoOrthographic";
    },
    setOverlayRange(state, range) {
      state.rendering.overlayRange = Array.isArray(range) ? range.slice(0, 2) : null;
    },
    setRenderConfigOption(state, { group, key, value }) {
      if (!state.renderConfig[group] || !Object.prototype.hasOwnProperty.call(state.renderConfig[group], key)) return;
      state.renderConfig[group][key] = Array.isArray(value) ? [...value] : value;
    },
    setStatus(state, statusRaw) {
      state.statusRaw = statusRaw || "";
    },
    setPageReady(state, ready) {
      state.pageReady = Boolean(ready);
    },
    setError(state, error) {
      state.error = error || "";
    },
    setGpuInfo(state, { webglInfo, gpuInfo }) {
      if (webglInfo != null) state.webglInfo = webglInfo;
      if (gpuInfo != null) state.gpuInfo = gpuInfo;
    },
    setPerformance(state, { fps, frameMs }) {
      if (fps != null) state.performance.fps = fps;
      if (frameMs != null) state.performance.frameMs = frameMs;
    },
    setViewMetrics(state, { zoom, scale, resolution }) {
      if (zoom != null) state.viewMetrics.zoom = zoom;
      if (scale != null) state.viewMetrics.scale = scale;
      if (resolution != null) state.viewMetrics.resolution = resolution;
    },
    setLayerInfo(state, { fileName, shape }) {
      if (fileName != null) state.layerInfo.fileName = fileName;
      if (shape != null) state.layerInfo.shape = shape;
    },
    showReadout(state) {
      state.readout.visible = true;
    },
    closeReadout(state) {
      state.readout.visible = false;
      state.readout.markerVisible = false;
      state.readout.value = "click map for values";
    },
    setReadoutValue(state, value) {
      state.readout.visible = true;
      state.readout.value = value || "";
    },
    setReadoutMarker(state, { visible, x, y }) {
      state.readout.markerVisible = Boolean(visible);
      if (x != null) state.readout.markerX = x;
      if (y != null) state.readout.markerY = y;
    },
    togglePanel(state, panelId) {
      if (!Object.prototype.hasOwnProperty.call(state.panels, panelId)) return;
      state.panels[panelId] = !state.panels[panelId];
    }
  },
  actions: {
    configureDataBase({ commit }, url) {
      commit("setDataBaseUrl", url);
    },
    setRenderingOption({ commit }, payload) {
      commit("setRenderingOption", payload);
    },
    setProjection({ commit }, projection) {
      commit("setProjection", projection);
    },
    setOverlayRange({ commit }, range) {
      commit("setOverlayRange", range);
    },
    setRenderConfigOption({ commit }, payload) {
      commit("setRenderConfigOption", payload);
    }
  }
});

export const viewerState = store.state;

export function projectionModeValue(name) {
  return store.getters.projectionMode[name] ?? 0;
}

export function setProjection(projection) {
  store.dispatch("setProjection", projection);
}

export function setOverlayVisible(visible) {
  store.commit("setOverlayVisible", visible);
}

export function setRenderingOption(key, value) {
  store.dispatch("setRenderingOption", { key, value });
}

export function setOverlayRange(range) {
  store.dispatch("setOverlayRange", range);
}

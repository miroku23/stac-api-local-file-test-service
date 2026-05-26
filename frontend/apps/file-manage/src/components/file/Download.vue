<template>
  <section class="surface download-surface h-full min-h-0 overflow-hidden">
    <div class="download-layout">
      <Tabs v-model:value="activeProvider" class="provider-tabs shrink-0">
        <TabList>
          <Tab v-for="provider in providers" :key="provider.key" :value="provider.key">
            <span class="inline-flex min-w-0 items-center gap-2">
              <i class="material-symbols-rounded icon !text-[18px]">{{ providerIcon(provider.key) }}</i>
              <span class="truncate">{{ provider.key }}</span>
            </span>
          </Tab>
        </TabList>
      </Tabs>

      <form class="download-form" @submit.prevent="submit">
        <div class="download-form-scroll app-scroll">
          <component
            :is="activeProviderForm"
            :form="form"
            :text="downloadText"
            :request-summary="requestSummary"
            :category-label="categoryLabel"
            :category-options="categoryOptions"
            :detail-label="detailLabel"
            :detail-options="detailOptions"
            :resolution-label="resolutionLabel"
            :resolution-options="currentResolutionOptions"
            :forecast-step-options="forecastStepSelectOptions"
            :time-options="timeSelectOptions"
            :show-depth="showDepth"
            :variable-options="variableOptions"
            :dataset-loading="datasetLoading"
            :area-limits="areaLimits"
            :area-presets="areaPresets"
            @apply-area-preset="applyAreaPreset"
            @open-dataset="openDatasetLayer"
          />
        </div>

        <div class="submit-row">
          <Message :severity="messageSeverity" size="small" class="!m-0 !flex-1">
            {{ message || downloadText.readyMessage }}
          </Message>
          <Button class="primary" :loading="loading" type="submit" :label="downloadText.downloadButton">
            <template #icon><i class="material-symbols-rounded icon">download</i></template>
          </Button>
        </div>
      </form>
    </div>

    <Dialog v-model:visible="datasetLayerOpen" modal class="dataset-dialog">
      <template #header>
        <div class="grid gap-1">
          <h2 class="m-0 text-base">Earthdata Datasets</h2>
          <span class="text-xs text-[var(--zarr-muted)]">{{ activeProvider }} / {{ form.category }} / {{ form.detail || "L2" }}</span>
        </div>
      </template>

      <Message v-if="datasetMessage" :severity="datasetMessageType === 'error' ? 'error' : 'info'" size="small" class="!mb-3">
        {{ datasetMessage }}
      </Message>
      <DataView :value="datasetResults" data-key="concept_id" class="dataset-list">
        <template #empty>
          <Message severity="secondary" size="small" class="!m-0">{{ downloadText.datasetEmpty }}</Message>
        </template>
        <template #list="{ items }">
          <div class="grid gap-2">
            <Button
              v-for="dataset in items"
              :key="dataset.concept_id || dataset.short_name || dataset.entry_title"
              text
              severity="secondary"
              class="dataset-item !justify-start !rounded-md !border !px-3 !py-2 !text-left"
              :class="dataset.short_name === form.datasetShortName ? '!border-[var(--zarr-accent)] !bg-cyan-50' : '!border-[var(--zarr-border)] !bg-slate-50'"
              @click="selectDataset(dataset)"
            >
              <span class="grid min-w-0 gap-1">
                <strong class="truncate text-sm text-slate-800">{{ dataset.short_name || dataset.entry_title }}</strong>
                <span class="truncate text-xs text-[var(--zarr-muted)]">{{ dataset.entry_title }}</span>
                <small class="truncate text-xs text-[var(--zarr-muted)]">{{ compactDatasetMeta(dataset).join(" / ") }}</small>
              </span>
            </Button>
          </div>
        </template>
      </DataView>
    </Dialog>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import Button from "primevue/button";
import DataView from "primevue/dataview";
import Dialog from "primevue/dialog";
import Message from "primevue/message";
import Tab from "primevue/tab";
import TabList from "primevue/tablist";
import Tabs from "primevue/tabs";
import lodash from "lodash";
import dayjs from "dayjs";
import GFSForm from "./download/form/GFS.vue";
import ECMWFForm from "./download/form/ECMWF.vue";
import CMEMSForm from "./download/form/CMEMS.vue";
import TEMPOForm from "./download/form/TEMPO.vue";
import SENTINEL5PForm from "./download/form/SENTINEL5P.vue";
import TLEForm from "./download/form/TLE.vue";

const API_BASE = __API_BASE__;
const SURFACE_DEPTH = 0.49402499198913574;
const { cloneDeep, compact, find, map, range } = lodash;
const store = useStore();
const messages = computed(() => store.getters.messages);
const downloadText = computed(() => messages.value.download);

const providers = computed(() => downloadText.value.providers);
const providerForms = {
  GFS: GFSForm,
  ECMWF: ECMWFForm,
  CMEMS: CMEMSForm,
  TEMPO: TEMPOForm,
  SENTINEL5P: SENTINEL5PForm,
  TLE: TLEForm
};

const gfsCategories = computed(() => [
  { value: "WIND", label: downloadText.value.categories.weather.WIND },
  { value: "TEMP", label: downloadText.value.categories.weather.TEMP },
  { value: "CURRENT", label: downloadText.value.categories.weather.CURRENT },
  { value: "RH", label: downloadText.value.categories.weather.RH },
  { value: "HPA", label: downloadText.value.categories.weather.HPA },
  { value: "PRECIP", label: downloadText.value.categories.weather.PRECIP }
]);

const ecmwfCategories = computed(() => [
  { value: "WIND", label: downloadText.value.categories.weather.WIND },
  { value: "TEMP", label: downloadText.value.categories.weather.TEMP },
  { value: "RH", label: downloadText.value.categories.weather.RH },
  { value: "HPA", label: downloadText.value.categories.weather.HPA },
  { value: "PRECIP", label: downloadText.value.categories.weather.PRECIP }
]);

const cmemsCategories = computed(() => [
  { value: "CURRENT_6H", label: downloadText.value.categories.cmems.CURRENT_6H },
  { value: "SURFACE_CURRENT_HOURLY", label: downloadText.value.categories.cmems.SURFACE_CURRENT_HOURLY },
  { value: "CURRENT_MONTHLY", label: downloadText.value.categories.cmems.CURRENT_MONTHLY },
  { value: "CURRENT", label: downloadText.value.categories.cmems.CURRENT }
]);

const sentinel5pCategories = computed(() => [
  { value: "NO2", label: downloadText.value.categories.sentinel5p.NO2, levels: ["L2", "L3"] },
  { value: "O3_TOT", label: downloadText.value.categories.sentinel5p.O3_TOT, levels: ["L2", "L3"] },
  { value: "SO2", label: downloadText.value.categories.sentinel5p.SO2, levels: ["L2"] },
  { value: "CO", label: downloadText.value.categories.sentinel5p.CO, levels: ["L2"] },
  { value: "CH4", label: downloadText.value.categories.sentinel5p.CH4, levels: ["L2"] },
  { value: "HCHO", label: downloadText.value.categories.sentinel5p.HCHO, levels: ["L2"] },
  { value: "AER_AI", label: downloadText.value.categories.sentinel5p.AER_AI, levels: ["L2"] },
  { value: "AER_LH", label: downloadText.value.categories.sentinel5p.AER_LH, levels: ["L2"] },
  { value: "CLOUD", label: downloadText.value.categories.sentinel5p.CLOUD, levels: ["L2"] }
]);

const tempoCategories = computed(() => [
  { value: "O3PROF", label: downloadText.value.categories.tempo.O3PROF, levels: ["L2", "L3"] },
  { value: "O3TOT", label: downloadText.value.categories.tempo.O3TOT, levels: ["L2", "L3"] },
  { value: "NO2", label: downloadText.value.categories.tempo.NO2, levels: ["L2", "L3"] },
  { value: "HCHO", label: downloadText.value.categories.tempo.HCHO, levels: ["L2", "L3"] },
  { value: "CLDO4", label: downloadText.value.categories.tempo.CLDO4, levels: ["L2", "L3"] }
]);

const tleCategories = [
  { value: "GK2", label: "GK-2B / GEO-KOMPSAT-2B", name: "GEO-KOMPSAT-2B", satellite: "GEMS" },
  { value: "SENTINEL5P", label: "Sentinel-5P", name: "SENTINEL-5P", satellite: "SENTINEL5P" },
  { value: "TEMPO", label: "TEMPO / DIRECTV 5", name: "DIRECTV 5", satellite: "TEMPO" }
];

const detailMap = computed(() => ({
  GFS: {
    WIND: { label: downloadText.value.detail.windLevel, param: "level", options: [
      { value: "surface", label: downloadText.value.detail.surface10m },
      { value: "100m", label: "100 m" },
      { value: "850", label: "850 hPa" },
      { value: "700", label: "700 hPa" },
      { value: "500", label: "500 hPa" }
    ] },
    TEMP: { label: downloadText.value.detail.tempType, param: "type", options: [
      { value: "2t", label: downloadText.value.detail.temp2m },
      { value: "skt", label: downloadText.value.detail.skinTemp },
      { value: "850", label: "850 hPa temperature" },
      { value: "700", label: "700 hPa temperature" },
      { value: "500", label: "500 hPa temperature" }
    ] },
    RH: { label: downloadText.value.detail.humidityLevel, param: "level", options: [
      { value: "surface", label: downloadText.value.detail.surface2m },
      { value: "850", label: "850 hPa" },
      { value: "700", label: "700 hPa" },
      { value: "500", label: "500 hPa" }
    ] }
  },
  ECMWF: {
    WIND: { label: downloadText.value.detail.windLevelType, param: "level", options: [
      { value: "10m", label: downloadText.value.detail.wind10m },
      { value: "100m", label: downloadText.value.detail.wind100m },
      { value: "gust", label: downloadText.value.detail.gust10m }
    ] },
    TEMP: { label: downloadText.value.detail.tempType, param: "type", options: [
      { value: "2t", label: downloadText.value.detail.temp2m },
      { value: "skt", label: downloadText.value.detail.skinTemp },
      { value: "sst", label: downloadText.value.detail.seaSurfaceTemp },
      { value: "mx2t", label: downloadText.value.detail.maxTemp },
      { value: "mn2t", label: downloadText.value.detail.minTemp }
    ] },
    PRECIP: { label: downloadText.value.detail.precipType, param: "type", options: [
      { value: "tp", label: downloadText.value.detail.totalPrecip },
      { value: "sd", label: downloadText.value.detail.snowDepth }
    ] }
  }
}));

const resolutionOptions = computed(() => [
  { value: "0p25", label: downloadText.value.resolution.high025 },
  { value: "0p50", label: downloadText.value.resolution.normal050 },
  { value: "1p00", label: downloadText.value.resolution.fast100 }
]);
const satelliteResolutionOptions = computed(() => [
  { value: "high", label: downloadText.value.resolution.satelliteHigh },
  { value: "std", label: downloadText.value.resolution.satelliteStd }
]);
const cmemsVariables = computed(() => ({
  CURRENT: [{ value: "uo", label: downloadText.value.variables.uo }, { value: "vo", label: downloadText.value.variables.vo }],
  CURRENT_6H: [{ value: "uo", label: downloadText.value.variables.uo }, { value: "vo", label: downloadText.value.variables.vo }],
  CURRENT_MONTHLY: [{ value: "uo", label: downloadText.value.variables.uo }, { value: "vo", label: downloadText.value.variables.vo }],
  SURFACE_CURRENT_HOURLY: [
    { value: "utotal", label: downloadText.value.variables.utotal },
    { value: "vtotal", label: downloadText.value.variables.vtotal },
    { value: "uo", label: downloadText.value.variables.uoModel },
    { value: "vo", label: downloadText.value.variables.voModel },
    { value: "utide", label: downloadText.value.variables.utide },
    { value: "vtide", label: downloadText.value.variables.vtide },
    { value: "vsdx", label: downloadText.value.variables.vsdx },
    { value: "vsdy", label: downloadText.value.variables.vsdy }
  ]
}));
const cmemsTimes = {
  CURRENT: ["00"],
  CURRENT_6H: ["00", "06", "12", "18"],
  CURRENT_MONTHLY: ["00"],
  SURFACE_CURRENT_HOURLY: map(range(24), (hour) => String(hour).padStart(2, "0"))
};
const areaPresets = [
  { name: "Global", n: 90, w: -180, s: -90, e: 180 },
  { name: "Korea", n: 43, w: 124, s: 32, e: 132 },
  { name: "East Asia", n: 55, w: 105, s: 15, e: 150 }
];

const providerDefaults = {
  GFS: baseForm({ date: dayjs().subtract(1, "day").toDate(), category: "WIND", detail: "surface", resolution: "0p25" }),
  ECMWF: baseForm({ date: dayjs().toDate(), category: "WIND", detail: "10m", resolution: "native" }),
  CMEMS: baseForm({ date: dayjs().subtract(2, "day").toDate(), category: "CURRENT_6H", variables: ["uo", "vo"] }),
  TEMPO: baseForm({ date: dayjs().subtract(1, "day").toDate(), category: "O3PROF", detail: "L2", resolution: "std" }),
  SENTINEL5P: baseForm({ date: dayjs().subtract(1, "day").toDate(), category: "NO2", detail: "L2", resolution: "high" }),
  TLE: baseForm({ date: dayjs().toDate(), category: "GK2" })
};

const activeProvider = ref("GFS");
const loading = ref(false);
const message = ref("");
const messageType = ref("info");
const datasetLayerOpen = ref(false);
const datasetLoading = ref(false);
const datasetMessage = ref("");
const datasetMessageType = ref("info");
const datasetResults = ref([]);
const form = reactive(cloneDeep(providerDefaults.GFS));

const satelliteDownloadProviders = new Set(["TEMPO", "SENTINEL5P"]);
const isSatelliteDownload = computed(() => satelliteDownloadProviders.has(activeProvider.value));
const activeProviderForm = computed(() => providerForms[activeProvider.value] || GFSForm);
const categoryLabel = computed(() => {
  if (activeProvider.value === "CMEMS") return downloadText.value.labels.model;
  if (activeProvider.value === "TLE") return downloadText.value.labels.satellite;
  if (isSatelliteDownload.value) return downloadText.value.labels.product;
  return downloadText.value.labels.category;
});
const categoryOptions = computed(() => {
  if (activeProvider.value === "TLE") return tleCategories;
  if (activeProvider.value === "TEMPO") return tempoCategories.value;
  if (activeProvider.value === "SENTINEL5P") return sentinel5pCategories.value;
  if (activeProvider.value === "CMEMS") return cmemsCategories.value;
  if (activeProvider.value === "ECMWF") return ecmwfCategories.value;
  return gfsCategories.value;
});
const selectedCategoryLabel = computed(() => find(categoryOptions.value, { value: form.category })?.label || form.category);
const detailConfig = computed(() => detailMap.value[activeProvider.value]?.[form.category] || null);
const detailOptions = computed(() => {
  if (isSatelliteDownload.value) return map(find(categoryOptions.value, { value: form.category })?.levels || [], (level) => ({ value: level, label: level }));
  return detailConfig.value?.options || [];
});
const detailLabel = computed(() => isSatelliteDownload.value ? "Level" : detailConfig.value?.label || downloadText.value.labels.detail);
const selectedDetailLabel = computed(() => find(detailOptions.value, { value: form.detail })?.label || "");
const showStep = computed(() => activeProvider.value === "GFS" || activeProvider.value === "ECMWF");
const showResolution = computed(() => activeProvider.value === "GFS" || isSatelliteDownload.value);
const resolutionLabel = computed(() => isSatelliteDownload.value ? "Resolution" : downloadText.value.labels.forecastStep);
const currentResolutionOptions = computed(() => isSatelliteDownload.value ? satelliteResolutionOptions.value : resolutionOptions.value);
const showDepth = computed(() => activeProvider.value === "CMEMS" && form.category !== "SURFACE_CURRENT_HOURLY");
const forecastStepOptions = computed(() => map(range(41), (index) => index * 3));
const forecastStepSelectOptions = computed(() => map(forecastStepOptions.value, (step) => ({ value: step, label: `+${step}h` })));
const timeOptions = computed(() => {
  if (activeProvider.value === "ECMWF") return ["00", "12"];
  if (activeProvider.value === "CMEMS") return cmemsTimes[form.category] || ["00"];
  return ["00", "06", "12", "18"];
});
const timeSelectOptions = computed(() => map(timeOptions.value, (time) => ({ value: time, label: `${time}:00` })));
const variableOptions = computed(() => activeProvider.value === "CMEMS" ? cmemsVariables.value[form.category] || [] : []);
const areaLimits = computed(() => ({ latMin: -90, latMax: 90, lonMin: -180, lonMax: 180 }));
const requestSummary = computed(() => compact([
  selectedCategoryLabel.value,
  selectedDetailLabel.value,
  showResolution.value ? find(currentResolutionOptions.value, { value: form.resolution })?.label || form.resolution : ""
]).join(" / "));
const messageSeverity = computed(() => {
  if (messageType.value === "error") return "error";
  if (messageType.value === "success") return "success";
  return "secondary";
});

watch(activeProvider, (provider) => {
  Object.assign(form, cloneDeep(providerDefaults[provider]));
  syncDependentFields();
  message.value = "";
  messageType.value = "info";
  resetDatasetSelection();
});
watch(() => form.category, () => {
  resetDatasetSelection();
  syncDependentFields();
});
watch(() => form.detail, resetDatasetSelection);

function baseForm(overrides = {}) {
  return {
    date: dayjs().toDate(),
    time: "00",
    category: "",
    detail: "",
    resolution: "native",
    step: 0,
    n: 90,
    s: -90,
    w: -180,
    e: 180,
    variables: [],
    datasetShortName: "",
    datasetTitle: "",
    minimumDepth: SURFACE_DEPTH,
    maximumDepth: SURFACE_DEPTH,
    ...overrides
  };
}

function providerIcon(provider) {
  if (provider === "CMEMS") return "waves";
  if (provider === "TLE") return "satellite_alt";
  if (satelliteDownloadProviders.has(provider)) return "satellite_alt";
  return "cloud_download";
}

function syncDependentFields() {
  const detail = detailOptions.value[0]?.value || "";
  if (detailOptions.value.length && !detailOptions.value.some((option) => option.value === form.detail)) form.detail = detail;
  if (!detailOptions.value.length) form.detail = "";
  if (!timeOptions.value.includes(form.time)) form.time = timeOptions.value[0] || "00";
  if (isSatelliteDownload.value && !satelliteResolutionOptions.value.some((option) => option.value === form.resolution)) form.resolution = "std";
  if (!isSatelliteDownload.value && activeProvider.value === "GFS" && !resolutionOptions.value.some((option) => option.value === form.resolution)) form.resolution = "0p25";
  if (showStep.value && !forecastStepOptions.value.includes(Number(form.step))) form.step = forecastStepOptions.value[0] || 0;
  if (variableOptions.value.length) {
    const valid = new Set(map(variableOptions.value, "value"));
    form.variables = form.variables.filter((variable) => valid.has(variable));
    if (!form.variables.length) form.variables = map(variableOptions.value.slice(0, 2), "value");
  } else {
    form.variables = [];
  }
  if (showDepth.value) {
    if (!Number.isFinite(Number(form.minimumDepth))) form.minimumDepth = SURFACE_DEPTH;
    if (!Number.isFinite(Number(form.maximumDepth))) form.maximumDepth = form.minimumDepth;
    if (Number(form.maximumDepth) < Number(form.minimumDepth)) form.maximumDepth = form.minimumDepth;
  }
}

function applyAreaPreset(preset) {
  Object.assign(form, { n: preset.n, w: preset.w, s: preset.s, e: preset.e });
}

function compactDatasetMeta(dataset) {
  return compact([dataset.provider, dataset.version, dataset.level]);
}

function dateText(format = "YYYY-MM-DD") {
  return dayjs(form.date).format(format);
}

function buildExtraParams() {
  const extra = { overwrite: true };
  if (activeProvider.value === "TLE") {
    const selected = find(tleCategories, { value: form.category });
    if (selected) Object.assign(extra, { name: selected.name, satellite: selected.satellite });
    return extra;
  }
  if (isSatelliteDownload.value) {
    Object.assign(extra, {
      satellite: activeProvider.value,
      payload: activeProvider.value === "SENTINEL5P" ? "TROPOMI" : "TEMPO",
      product_type: form.category,
      target_date: dateText(),
      level: form.detail || detailOptions.value[0]?.value || "L2",
      resolution: form.resolution || "std"
    });
    if (form.datasetShortName) extra.short_name = form.datasetShortName;
    if ([form.n, form.w, form.s, form.e].every((value) => Number.isFinite(Number(value)))) {
      extra.roi = {
        min_lon: Math.min(Number(form.w), Number(form.e)),
        min_lat: Math.min(Number(form.s), Number(form.n)),
        max_lon: Math.max(Number(form.w), Number(form.e)),
        max_lat: Math.max(Number(form.s), Number(form.n))
      };
    }
    return extra;
  }
  if (showStep.value) extra.step = Number(form.step || 0);
  if (showResolution.value) extra.resolution = form.resolution;
  if (detailConfig.value?.param && form.detail) extra[detailConfig.value.param] = form.detail;
  if (activeProvider.value === "CMEMS") {
    extra.variables = form.variables;
    if (showDepth.value) {
      extra.minimum_depth = Number(form.minimumDepth);
      extra.maximum_depth = Number(form.maximumDepth);
    }
  }
  return extra;
}

function resetDatasetSelection() {
  form.datasetShortName = "";
  form.datasetTitle = "";
  datasetResults.value = [];
  datasetMessage.value = "";
  datasetMessageType.value = "info";
}

async function openDatasetLayer() {
  datasetLayerOpen.value = true;
  await fetchDatasets();
}

async function fetchDatasets() {
  datasetLoading.value = true;
  datasetMessage.value = "";
  datasetMessageType.value = "info";
  datasetResults.value = [];
  try {
    const response = await fetch(`${API_BASE}/weather/download/datasets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ satellite: activeProvider.value, count: 100 })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || downloadText.value.datasetFetchFailed);
    datasetResults.value = data.data || [];
    datasetMessage.value = datasetResults.value.length ? downloadText.value.datasetFound(datasetResults.value.length) : downloadText.value.datasetEmpty;
  } catch (error) {
    datasetMessageType.value = "error";
    datasetMessage.value = error.message;
  } finally {
    datasetLoading.value = false;
  }
}

function selectDataset(dataset) {
  form.datasetShortName = dataset.short_name || "";
  form.datasetTitle = dataset.entry_title || "";
  datasetLayerOpen.value = false;
}

async function submit() {
  loading.value = true;
  message.value = "";
  messageType.value = "info";
  const endpoint = `${API_BASE}/weather/download/${activeProvider.value.toLowerCase().replace(/-/g, "")}`;
  const payload = {
    date: dateText("YYYYMMDD"),
    time: form.time,
    category: form.category,
    area: [Number(form.n), Number(form.w), Number(form.s), Number(form.e)],
    extra_params: buildExtraParams()
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || downloadText.value.downloadFailed);
    messageType.value = "success";
    message.value = downloadText.value.completed(data.data?.file_name);
    store.commit("setLastDownload", data.data || null);
    store.dispatch("pushNotification", { type: "success", message: message.value });
  } catch (error) {
    messageType.value = "error";
    message.value = error.message;
    store.dispatch("pushNotification", { type: "error", message: error.message });
  } finally {
    loading.value = false;
  }
}
</script>

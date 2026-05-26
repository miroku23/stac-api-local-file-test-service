<template>
  <section
    @dragover.prevent="handleDragOver"
    @drop.prevent="handleDrop"
  >
    <div class="relative flex h-full min-h-0 flex-col">
      <p v-if="message" class="message border-b border-[var(--zarr-border)] px-3 py-2">{{ message }}</p>

      <FileUploadPrompt
        v-if="!filePath"
        :message="localFileMessage"
        :accept="supportedAccept"
        @browse="openFilePicker"
        @select-local="selectLocalFile"
      />

      <EmptyState v-else-if="error" title="Unable to read file" :description="error" />

      <div v-else-if="selectedInfo" class="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden text-[13px]">
        <div class="mx-3 mt-3 flex min-h-0 flex-wrap items-center gap-2 border border-[var(--zarr-border)] bg-slate-50/80 px-3 py-2">
          <span class="font-bold text-[var(--zarr-muted)]">Format</span>
          <strong>{{ fileInfo.format || fileInfo.extension || "-" }}</strong>
          <span class="mx-1 h-4 border-l border-slate-300"></span>
          <span class="font-bold text-[var(--zarr-muted)]">Size</span>
          <strong>{{ fileInfo.size || "-" }}</strong>
          <span class="mx-1 h-4 border-l border-slate-300"></span>
          <span class="font-bold text-[var(--zarr-muted)]">Modified</span>
          <strong>{{ formattedModified }}</strong>
        </div>

        <div class="app-scroll grid min-h-0 items-start gap-3 overflow-auto p-3 lg:grid-cols-[minmax(320px,0.9fr)_minmax(420px,1.1fr)]">
          <ConvertInfo :report="inspectionReport" />
          <ConvertSetting
            v-model:selected-products="selectedProducts"
            :product-options="productOptions"
            :form="zarrForm"
            :report="inspectionReport"
            :result-text="resultText"
          />
        </div>

        <div class="submit-row">
          <span class="message">{{ result?.message || messages.convert.resultPending }}</span>
          <Button class="primary" :label="messages.convertSetting.run" severity="success" :disabled="!canConvert" :loading="converting" @click="runZarr">
            <template #icon><i class="material-symbols-rounded icon">sync_alt</i></template>
          </Button>
        </div>
      </div>

      <EmptyState v-else-if="!loading" title="No details" description="No file metadata was returned." />

      <input ref="nativeFileInputRef" type="file" class="hidden" :accept="supportedAccept" @change="selectNativeLocalFile" />

      <div v-if="loading" class="absolute inset-0 z-40 grid place-items-center bg-white/65 backdrop-blur-[1px]">
        <ProgressSpinner class="!h-12 !w-12" stroke-width="4" />
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { EmptyState } from "@zarr/ui";
import Button from "primevue/button";
import ProgressSpinner from "primevue/progressspinner";
import ConvertInfo from "./convert/Info.vue";
import ConvertSetting from "./convert/Setting.vue";
import FileUploadPrompt from "./Upload.vue";

const API_BASE = __API_BASE__;
const supportedAccept = ".nc,.netcdf,.grib,.grib2,.grb,.grb2";
const supportedExtensions = new Set([".nc", ".netcdf", ".grib", ".grib2", ".grb", ".grb2"]);

const props = defineProps({
  windowKey: { type: String, required: true },
  filePath: { type: String, default: "" },
  fileRoot: { type: String, default: "data" },
  message: { type: String, default: "" }
});

const emit = defineEmits(["loading"]);
const store = useStore();

const loading = ref(false);
const converting = ref(false);
const selectedInfo = ref(null);
const error = ref("");
const result = ref(null);
const localFileMessage = ref("");
const nativeFileInputRef = ref(null);
const selectedProducts = ref([]);
const currentConvertJobId = ref("");
const activeRequests = new Set();

const zarrForm = reactive({
  resampling: "average",
  crsTarget: "keep",
  dataType: "keep",
  chunkSizeX: 256,
  chunkSizeY: 256,
  levelMin: 0,
  levelMax: 3,
  executeSinglePass: false,
  convertNan: true,
  pyramid: true,
  consolidated: true,
  outputPath: ""
});

const fileInfo = computed(() => selectedInfo.value?.file_info || {});
const detail = computed(() => selectedInfo.value?.detail || {});
const selectedPickerFile = computed(() => store.state.file.filePickerSelections[props.windowKey]);
const messages = computed(() => store.getters.messages);
const dateLocale = computed(() => store.getters.dateLocale);
const formattedModified = computed(() => {
  if (!fileInfo.value.modified_at) return "-";
  return new Intl.DateTimeFormat(dateLocale.value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(fileInfo.value.modified_at));
});
const isSupportedFile = computed(() => supportedExtensions.has(String(fileInfo.value.extension || "").toLowerCase()));
const productOptions = computed(() => buildProductOptions(detail.value));
const selectedProductPayload = computed(() => selectedProducts.value);
const dimensionSummary = computed(() => collectDimensions(detail.value));
const maxDimension = computed(() => Math.max(0, ...dimensionSummary.value.map((item) => Number(item.size) || 0)));
const canConvert = computed(() => isSupportedFile.value && (!productOptions.value.length || selectedProducts.value.length > 0));
const inspectionReport = computed(() => buildInspectionReport());
const conversionJobs = computed(() => store.getters.conversionJobs);
const resultText = computed(() => (result.value ? JSON.stringify(result.value, null, 2) : messages.value.convert.resultPending));

watch(
  () => [props.filePath, props.fileRoot],
  ([nextPath]) => {
    abortWindowRequests();
    loadFile(nextPath);
  },
  { immediate: true }
);

watch(selectedPickerFile, (file) => {
  if (!file) return;
  setCurrentFile(file);
  store.dispatch("clearFilePickerSelection", props.windowKey);
  store.commit("setFilePickerTargetKey", "");
});

watch(productOptions, (items) => {
  selectedProducts.value = items;
});

watch(inspectionReport, (report) => {
  zarrForm.chunkSizeX = report.strategy.suggestedChunkX;
  zarrForm.chunkSizeY = report.strategy.suggestedChunkY;
  zarrForm.levelMin = report.strategy.minLevel;
  zarrForm.levelMax = Math.min(report.strategy.maxLevel, Math.max(report.strategy.minLevel, report.strategy.suggestedMaxLevel));
  zarrForm.dataType = report.strategy.recommendCastFloat32 ? "float32" : "keep";
  zarrForm.executeSinglePass = report.strategy.singlePassRequired;
  zarrForm.pyramid = report.strategy.usePyramid;
  zarrForm.resampling = report.strategy.suggestedResampling;
}, { immediate: true });

watch(conversionJobs, (jobs) => {
  const job = jobs.find((item) => item.id === currentConvertJobId.value);
  if (!job) return;
  if (job.status === "success") {
    result.value = {
      status: "success",
      message: job.message || messages.value.convert.completed,
      data: job.result
    };
  } else if (job.status === "error") {
    result.value = {
      status: "error",
      message: job.error || job.message || messages.value.convert.failed
    };
  } else if (job.status === "canceled") {
    result.value = {
      status: "canceled",
      message: job.message || messages.value.convert.canceled
    };
  }
}, { deep: true });

onMounted(() => {
  window.addEventListener("beforeunload", cleanupCurrentTempFile);
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", cleanupCurrentTempFile);
  abortWindowRequests();
  cleanupCurrentTempFile();
});

function buildProductOptions(value) {
  if (value?.type === "netcdf" && value.root) return netcdfProducts(value.root);
  if (value?.type === "grib2") {
    return (value.sections || [])
      .flatMap((section) => (Array.isArray(section.items) ? section.items : [])
        .filter(isGridVariable)
        .map((item) => ({
          id: `${section.name}:${item.name}`,
          label: item.name,
          kind: `${formatList(item.dimensions)} / ${formatList(item.shape, " x ")} / ${item.dtype || "-"}`,
          path: item.name,
          variable: item.name,
          dtype: item.dtype || "",
          shape: item.shape || [],
          dimensions: item.dimensions || [],
          attributes: item.attributes || {},
          variableCount: 1
        })));
  }
  return [];
}

function netcdfProducts(group, parent = "") {
  const path = group.path && group.path !== "/" ? group.path.replace(/^\//, "") : parent;
  const ownVariables = (group.variables || [])
    .filter(isGridVariable)
    .map((variable) => ({
      id: `${path || "/"}:${variable.name}`,
      label: variable.name,
      kind: `${formatList(variable.dimensions)} / ${formatList(variable.shape, " x ")} / ${variable.dtype || "-"}`,
      path: path || "/",
      variable: variable.name,
      dtype: variable.dtype || "",
      shape: variable.shape || [],
      dimensions: variable.dimensions || [],
      attributes: variable.attributes || {},
      variableCount: 1
    }));
  return [
    ...ownVariables,
    ...(group.groups || []).flatMap((child) => netcdfProducts(child, path))
  ];
}

function isGridVariable(item = {}) {
  const dimensions = Array.isArray(item.dimensions) ? item.dimensions : [];
  const shape = Array.isArray(item.shape) ? item.shape : [];
  if (dimensions.length < 2 || shape.length < 2) return false;
  if (shape.filter((size) => Number(size) > 1).length < 2) return false;
  const dtype = String(item.dtype || "").toLowerCase();
  return !dtype.includes("str") && !dtype.includes("object");
}

function collectDimensions(value) {
  if (value?.type === "netcdf") return Object.entries(value.root?.dimensions || {}).map(([name, size]) => ({ name, size }));
  if (value?.type === "grib2") {
    const section = (value.sections || []).find((item) => item.name === "Dimensions");
    return Object.entries(section?.items || {}).map(([name, size]) => ({ name, size }));
  }
  return [];
}

function formatList(value, separator = ", ") {
  return Array.isArray(value) && value.length ? value.join(separator) : "-";
}

function buildInspectionReport() {
  const spatial = inferSpatialShape(productOptions.value, dimensionSummary.value);
  const timeSteps = findDimensionSize(dimensionSummary.value, ["time"], 1);
  const levelSteps = findDimensionSize(dimensionSummary.value, ["level", "depth", "plev", "isobaric"], 1);
  const totalPixels = spatial.width && spatial.height ? spatial.width * spatial.height : 0;
  const variables = productOptions.value.map((item) => item.label);
  const dataTypes = [...new Set(productOptions.value.map((item) => String(item.dtype || "").trim()).filter(Boolean))];
  const suggestedResampling = inferResampling(productOptions.value, totalPixels);
  const hasFloat64 = dataTypes.some((dtype) => dtype.toLowerCase().includes("float64"));
  const allAttributes = collectAttributes(detail.value);
  const hasFillValue = allAttributes.some(([name]) => ["_fillvalue", "missing_value", "fill_value"].includes(String(name).toLowerCase()));
  const hasCrs = allAttributes.some(([name, value]) => {
    const key = String(name).toLowerCase();
    const text = String(value || "").toLowerCase();
    return key.includes("crs") || key === "spatial_ref" || key === "grid_mapping" || key.includes("projection") || text.includes("epsg:");
  });
  const reasons = [];
  if (totalPixels > 16000000) reasons.push(messages.value.convert.heavyGridReason(totalPixels));
  if (timeSteps * levelSteps > 24) reasons.push(messages.value.convert.axisReason(timeSteps, levelSteps));
  if (variables.length > 15) reasons.push(messages.value.convert.variableReason(variables.length));
  if (spatial.width > 0 && spatial.height > 0 && Math.max(spatial.width, spatial.height) / Math.max(1, Math.min(spatial.width, spatial.height)) > 8) {
    reasons.push(messages.value.convert.asymmetricReason(spatial.width, spatial.height));
  }
  const baseChunk = totalPixels > 4000000 ? 512 : 256;
  const suggestedChunkY = spatial.height && spatial.height < baseChunk ? spatial.height : baseChunk;
  const largestSide = Math.max(spatial.width, spatial.height, baseChunk);
  const usePyramid = totalPixels > 1000000 || largestSide > 2048;
  const minLevel = 0;
  const maxLevel = Math.min(9, Math.max(minLevel, Math.ceil(Math.log2(largestSide / 256))));
  const suggestedMaxLevel = Math.min(maxLevel, Math.max(minLevel, Math.ceil(Math.log2(largestSide / baseChunk))));
  const isHeavyPipeline = reasons.length > 0 || totalPixels > 36000000;
  return {
    fileName: fileInfo.value.name || fileInfo.value.path || props.filePath?.split("/").pop() || "-",
    dimensions: {
      width: spatial.width,
      height: spatial.height,
      totalPixels,
      timeSteps,
      levelSteps
    },
    variables,
    features: {
      hasCrs,
      hasFillValue,
      hasFloat64,
      dataTypes
    },
    strategy: {
      isHeavyPipeline,
      reasons,
      suggestedChunkX: baseChunk,
      suggestedChunkY,
      suggestedLevels: suggestedMaxLevel + 1,
      minLevels: minLevel,
      maxLevels: maxLevel,
      minLevel,
      maxLevel,
      suggestedMaxLevel,
      usePyramid,
      suggestedResampling,
      recommendCastFloat32: hasFloat64,
      singlePassRequired: isHeavyPipeline || totalPixels > 36000000
    }
  };
}

function inferResampling(products, totalPixels) {
  const names = products.map((item) => String(item.label || item.variable || "").toLowerCase());
  const dtypes = products.map((item) => String(item.dtype || "").toLowerCase());
  const joinedNames = names.join(" ");

  if (/\b(u|v|uo|vo|u10|v10)\b/.test(joinedNames) || joinedNames.includes("wind") || joinedNames.includes("current") || joinedNames.includes("velocity")) {
    return "cubic";
  }

  const categoricalName = names.some((name) => (
    name.includes("flag")
    || name.includes("mask")
    || name.includes("qa")
    || name.includes("class")
    || name.includes("category")
    || name.includes("type")
    || name.includes("cover")
    || name.includes("snow")
    || name.includes("ice")
    || name.includes("cloud")
  ));
  const integerOnly = dtypes.length > 0 && dtypes.every((dtype) => dtype.includes("int") || dtype.includes("uint") || dtype.includes("bool"));
  if (categoricalName || integerOnly) return "nearest";

  if (totalPixels > 4000000) return "average";
  return "bilinear";
}

function collectAttributes(value) {
  const attrs = [];
  if (!value) return attrs;
  if (value.type === "netcdf" && value.root) {
    collectGroupAttributes(value.root, attrs);
    return attrs;
  }
  if (value.type === "grib2") {
    for (const section of value.sections || []) {
      for (const item of Array.isArray(section.items) ? section.items : []) {
        attrs.push(...Object.entries(item.attributes || {}));
      }
    }
  }
  return attrs;
}

function collectGroupAttributes(group, attrs) {
  attrs.push(...Object.entries(group.attributes || {}));
  for (const variable of group.variables || []) {
    attrs.push(...Object.entries(variable.attributes || {}));
  }
  for (const child of group.groups || []) collectGroupAttributes(child, attrs);
}

function inferSpatialShape(products, dimensions) {
  const first = products.find((item) => Array.isArray(item.shape) && item.shape.length >= 2);
  if (first) {
    const shape = first.shape.map((item) => Number(item)).filter((item) => item > 1);
    if (shape.length >= 2) return { width: shape[shape.length - 1], height: shape[shape.length - 2] };
  }
  const width = findDimensionSize(dimensions, ["x", "lon", "longitude"], 0);
  const height = findDimensionSize(dimensions, ["y", "lat", "latitude"], 0);
  return { width, height };
}

function findDimensionSize(dimensions, names, fallback) {
  const item = dimensions.find((dim) => names.some((name) => String(dim.name).toLowerCase().includes(name)));
  return Number(item?.size) || fallback;
}

async function loadFile(path) {
  selectedInfo.value = null;
  error.value = "";
  result.value = null;
  currentConvertJobId.value = "";
  localFileMessage.value = "";
  zarrForm.outputPath = defaultZarrPath(path);
  if (!path) return;
  const controller = createWindowRequest();
  loading.value = true;
  emit("loading", true);
  try {
    const params = new URLSearchParams({ file_path: path, root: props.fileRoot || "data" });
    const response = await fetch(`${API_BASE}/inspect/structure?${params.toString()}`, {
      signal: controller.signal
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || "Failed to inspect file");
    selectedInfo.value = payload;
  } catch (err) {
    if (isAbortError(err)) return;
    error.value = err.message || "Failed to inspect file";
  } finally {
    finishWindowRequest(controller);
  }
}

async function runZarr() {
  await runConvert(`${API_BASE}/convert/zarr`, {
    options: {
      ...zarrForm,
      chunkSize: [zarrForm.chunkSizeX, zarrForm.chunkSizeY],
      pyramidLevelMin: zarrForm.levelMin,
      pyramidLevelMax: zarrForm.levelMax,
      pyramidIncludeOriginal: !zarrForm.executeSinglePass
    }
  });
}

function defaultZarrPath(path) {
  const normalized = String(path || "").replace(/^\/+/, "");
  if (!normalized) return "";
  const relative = normalized.replace(/^(DATA\/|raw\/)/, "");
  const withoutExtension = relative.replace(/\.[^/.]+$/, "");
  return `${withoutExtension}.zarr`;
}

async function runConvert(url, extraPayload) {
  const fileName = props.filePath?.split("/").pop() || messages.value.common.selectedFile;
  const jobId = `convert:${props.windowKey}:${Date.now()}`;
  const activeJobCount = store.getters.conversionJobs.filter((job) => ["queued", "running", "canceling", "error"].includes(job.status)).length;
  if (activeJobCount >= 5) {
    result.value = { status: "error", message: messages.value.convert.tooManyJobs };
    return;
  }
  converting.value = true;
  result.value = null;
  currentConvertJobId.value = jobId;
  store.dispatch("upsertConversionJob", {
    id: jobId,
    status: "running",
    title: messages.value.worker.zarrTitle.running,
    fileName,
    message: messages.value.convert.registering,
    progress: 0
  });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: props.filePath,
        root: props.fileRoot || "data",
        products: selectedProductPayload.value,
        ...extraPayload
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || "Conversion failed");
    if (payload.job?.id) {
      currentConvertJobId.value = payload.job.id;
      store.dispatch("removeConversionJob", jobId);
      store.dispatch("upsertConversionJob", payload.job);
    } else {
      store.dispatch("upsertConversionJob", {
        id: jobId,
        status: "queued",
        title: messages.value.worker.zarrTitle.running,
        fileName,
        message: payload.message || messages.value.convert.registered,
        progress: 0
      });
    }
  } catch (err) {
    const message = err.message || "Conversion failed";
    result.value = { status: "error", message };
    store.dispatch("upsertConversionJob", {
      id: jobId,
      status: "error",
      title: messages.value.worker.zarrTitle.error,
      fileName,
      message
    });
  } finally {
    converting.value = false;
  }
}

function openFilePicker() {
  store.commit("setFilePickerTargetKey", props.windowKey);
}

function setCurrentFile(row) {
  store.dispatch("setFileConvertFile", { key: props.windowKey, row });
}

async function selectLocalFile(event) {
  await uploadLocalFile(event.files?.[0]);
}

async function selectNativeLocalFile(event) {
  await uploadLocalFile(event.target.files?.[0]);
  event.target.value = "";
}

async function uploadLocalFile(file) {
  if (!file) return;
  const extension = `.${file.name.split(".").pop()}`.toLowerCase();
  if (!supportedExtensions.has(extension)) {
    localFileMessage.value = messages.value.convert.unsupportedFile;
    return;
  }
  const controller = createWindowRequest();
  loading.value = true;
  emit("loading", true);
  localFileMessage.value = messages.value.upload.uploading(file.name);
  try {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${API_BASE}/uploads/local-file`, {
      method: "POST",
      body: formData,
      signal: controller.signal
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || "Failed to upload file");
    localFileMessage.value = "";
    setCurrentFile({ name: payload.name, path: payload.path, root: payload.root || "temp", type: "file" });
  } catch (err) {
    if (isAbortError(err)) return;
    localFileMessage.value = err.message || messages.value.upload.localUploadFailed;
  } finally {
    finishWindowRequest(controller);
  }
}

function cleanupCurrentTempFile() {
  if (props.fileRoot === "temp" && props.filePath && !hasActiveConversionForCurrentFile()) {
    cleanupTempFile(props.filePath);
  }
}

function hasActiveConversionForCurrentFile() {
  const activeStatuses = new Set(["queued", "running"]);
  return store.getters.conversionJobs.some((job) => (
    activeStatuses.has(job.status)
    && String(job.file_path || "").replace(/\\/g, "/") === String(props.filePath || "").replace(/\\/g, "/")
  ));
}

async function cleanupTempFile(path) {
  if (!path) return;
  const params = new URLSearchParams({ file_path: path });
  await fetch(`${API_BASE}/uploads/local-file?${params.toString()}`, {
    method: "DELETE",
    keepalive: true
  }).catch(() => {});
}

function createWindowRequest() {
  const controller = new AbortController();
  activeRequests.add(controller);
  return controller;
}

function finishWindowRequest(controller) {
  activeRequests.delete(controller);
  if (!activeRequests.size) {
    loading.value = false;
    emit("loading", false);
  }
}

function abortWindowRequests() {
  for (const controller of activeRequests) {
    controller.abort();
  }
  activeRequests.clear();
  loading.value = false;
  emit("loading", false);
}

function isAbortError(err) {
  return err?.name === "AbortError";
}

function handleDragOver(event) {
  event.dataTransfer.dropEffect = "copy";
}

function handleDrop(event) {
  const raw = event.dataTransfer.getData("application/x-zarr-file");
  if (!raw) return;
  try {
    setCurrentFile(JSON.parse(raw));
  } catch {
    const path = event.dataTransfer.getData("text/plain");
    if (path) setCurrentFile({ path, name: path.split("/").pop(), root: "data" });
  }
}
</script>


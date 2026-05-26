<template>
  <section
    @dragover.prevent="handleDragOver"
    @drop.prevent="handleDrop"
  >
    <div class="relative h-full min-h-0">
      <div class="grid h-full min-h-0 grid-rows-[36px_minmax(0,1fr)]">
        <div class="relative z-30 grid min-h-0 grid-cols-[minmax(0,1fr)_auto] items-center overflow-visible border-b border-[var(--zarr-border)] bg-white">
          <Menubar :model="fileMenuItems" :pt="menubarPt" class="relative z-30 min-h-0 overflow-visible rounded-none border-0 bg-white px-2 py-0 text-sm">
            <template #item="{ item, props, hasSubmenu }">
              <a v-bind="props.action" class="flex items-center gap-2">
                <i v-if="item.materialIcon" class="material-symbols-rounded icon !text-[18px]">{{ item.materialIcon }}</i>
                <span>{{ item.label }}</span>
                <i v-if="hasSubmenu" class="material-symbols-rounded icon ml-auto !text-[18px]">chevron_right</i>
              </a>
            </template>
          </Menubar>
          <Button
            v-if="filePath && fileRoot === 'temp'"
            text
            size="small"
            :label="messages.upload.saveToStorage"
            class="!mr-2 !min-h-8 !px-3"
            @click="openStoragePicker"
          >
            <template #icon>
              <i class="material-symbols-rounded icon">save</i>
            </template>
          </Button>
        </div>

        <div class="app-scroll relative z-0 flex h-full min-h-0 flex-col overflow-hidden">
          <p v-if="message" class="message border-b border-[var(--zarr-border)] px-3 py-2">{{ message }}</p>

          <FileUploadPrompt
            v-if="!filePath"
            :message="localFileMessage"
            accept=".nc,.grib,.grib2,.grb2,.json,.geojson,.txt,.csv,.log,.xml,.yaml,.yml,.zip"
            @browse="openFilePicker"
            @select-local="selectLocalFile"
          />

          <EmptyState v-else-if="error" title="Unable to read file" :description="error" />
          <div v-else-if="selectedInfo" class="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden p-3 text-[13px]">
            <div class="min-h-0 flex flex-wrap items-center gap-2 border border-[var(--zarr-border)] bg-slate-50/80 px-3 py-2">
              <span class="font-bold text-[var(--zarr-muted)]">Format</span>
              <strong>{{ fileInfo.format || fileInfo.extension || "-" }}</strong>
              <span class="mx-1 h-4 border-l border-slate-300"></span>
              <span class="font-bold text-[var(--zarr-muted)]">Size</span>
              <strong>{{ fileInfo.size || "-" }}</strong>
              <span class="mx-1 h-4 border-l border-slate-300"></span>
              <span class="font-bold text-[var(--zarr-muted)]">Modified</span>
              <strong>{{ formattedModified }}</strong>
            </div>
            <JsonContent v-if="detailType === 'json'" :detail="detail" />
            <TextContent v-else-if="detailType === 'text'" :detail="detail" />
            <GribContent v-else-if="detailType === 'grib2'" :detail="detail" />
            <NetCDFContent v-else-if="detailType === 'netcdf'" :detail="detail" />
          </div>
          <EmptyState v-else-if="!loading" title="No details" description="No file metadata was returned." />
        </div>
      </div>

      <input ref="nativeFileInputRef" type="file" class="hidden" accept=".nc,.grib,.grib2,.grb2,.json,.geojson,.txt,.csv,.log,.xml,.yaml,.yml,.zip" @change="selectNativeLocalFile" />

      <div v-if="loading" class="absolute inset-0 z-40 grid place-items-center bg-white/65 backdrop-blur-[1px]">
        <ProgressSpinner class="!h-12 !w-12" stroke-width="4" />
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { EmptyState } from "@zarr/ui";
import Button from "primevue/button";
import Menubar from "primevue/menubar";
import ProgressSpinner from "primevue/progressspinner";
import FileUploadPrompt from "./Upload.vue";
import JsonContent from "./structure/Json.vue";
import GribContent from "./structure/Grib.vue";
import NetCDFContent from "./structure/NetCDF.vue";
import TextContent from "./structure/Text.vue";

const API_BASE = __API_BASE__;
const props = defineProps({
  windowKey: { type: String, required: true },
  filePath: { type: String, default: "" },
  fileRoot: { type: String, default: "data" },
  message: { type: String, default: "" }
});

const emit = defineEmits(["loading"]);
const store = useStore();

const loading = ref(false);
const selectedInfo = ref(null);
const error = ref("");
const localFileMessage = ref("");
const nativeFileInputRef = ref(null);
const activeRequests = new Set();

const fileInfo = computed(() => selectedInfo.value?.file_info || {});
const detail = computed(() => selectedInfo.value?.detail || {});
const detailType = computed(() => detail.value.type || "");
const selectedPickerFile = computed(() => store.state.file.filePickerSelections[props.windowKey]);
const selectedStorageFolder = computed(() => store.state.file.storageFolderSelections[props.windowKey]);
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

const fileMenuItems = computed(() => [
  {
    label: messages.value.detail.fileMenu,
    items: [
      { label: messages.value.detail.openFile, materialIcon: "search", command: openFilePicker },
      { label: messages.value.detail.openLocalFile, materialIcon: "folder_open", command: openLocalFile }
    ]
  }
]);

const menubarPt = {
  root: { class: "overflow-visible" },
  rootList: { class: "h-full" },
  itemLink: { class: "min-h-8 py-1" },
  submenu: { class: "z-50" }
};

watch(
  () => [props.filePath, props.fileRoot],
  ([nextPath], oldValue = []) => {
    const [oldPath, oldRoot] = oldValue;
    abortWindowRequests();
    if (oldRoot === "temp" && oldPath && oldPath !== nextPath) cleanupTempFile(oldPath);
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

watch(selectedStorageFolder, async (folder) => {
  if (!folder) return;
  await saveTempFileToStorage(folder);
  store.dispatch("clearStorageFolderSelection", props.windowKey);
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", cleanupCurrentTempFile);
  abortWindowRequests();
  cleanupCurrentTempFile();
});

onMounted(() => {
  window.addEventListener("beforeunload", cleanupCurrentTempFile);
});

function cleanupCurrentTempFile() {
  if (props.fileRoot === "temp" && props.filePath) cleanupTempFile(props.filePath);
}

async function loadFile(path) {
  selectedInfo.value = null;
  error.value = "";
  localFileMessage.value = "";
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

function openFilePicker() {
  store.commit("setFilePickerTargetKey", props.windowKey);
}

function openStoragePicker() {
  store.commit("setStoragePickerTargetKey", props.windowKey);
}

function openLocalFile() {
  nativeFileInputRef.value?.click();
}

function setCurrentFile(row) {
  store.dispatch("setFileViewFile", { key: props.windowKey, row });
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

async function saveTempFileToStorage(folder) {
  if (!props.filePath) return;
  const controller = createWindowRequest();
  loading.value = true;
  emit("loading", true);
  try {
    const response = await fetch(`${API_BASE}/uploads/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temp_path: props.filePath, target_dir: folder?.path || "" }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || messages.value.upload.saveFailed);
    setCurrentFile(payload);
    store.commit("setStoragePickerTargetKey", "");
  } catch (err) {
    if (isAbortError(err)) return;
    store.dispatch("patchWindow", {
      key: props.windowKey,
      patch: { message: err.message || messages.value.upload.saveFailed }
    });
  } finally {
    finishWindowRequest(controller);
  }
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

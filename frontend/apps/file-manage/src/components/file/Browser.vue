<template>
  <div :class="modal ? 'fixed inset-0 z-[90] grid place-items-center bg-slate-950/45 p-6 backdrop-blur-sm' : 'h-full min-h-0 min-w-0 overflow-hidden'">
    <div :class="modal ? 'grid h-[min(720px,calc(100vh-80px))] w-[min(1040px,calc(100vw-56px))] grid-rows-[40px_minmax(0,1fr)] overflow-hidden border border-white/30 bg-white shadow-2xl' : 'h-full min-h-0 min-w-0 overflow-hidden'">
      <header v-if="modal" class="flex min-w-0 items-center justify-between border-b border-slate-200 bg-white px-3">
        <div class="flex min-w-0 items-center gap-2">
          <i class="material-symbols-rounded icon filled !text-[22px] text-sky-500">folder_open</i>
          <strong class="truncate text-sm">{{ modalTitle }}</strong>
        </div>
        <Button text rounded class="!h-8 !w-8 !p-0 !text-slate-500" aria-label="Close file picker" @click="$emit('cancel-select')">
          <template #icon>
            <i class="material-symbols-rounded icon !text-[20px]">close</i>
          </template>
        </Button>
      </header>

      <section class="grid h-full min-h-0 text-slate-800 [color-scheme:light]" :class="selectMode ? 'grid-rows-[52px_minmax(0,1fr)_54px]' : 'grid-rows-[52px_minmax(0,1fr)]'">
        <ContextMenu v-if="!selectMode" ref="contextMenuRef" :model="contextMenuItems">
          <template #item="{ item, props }">
            <a v-bind="props.action" class="flex items-center gap-2">
              <i class="material-symbols-rounded icon !text-[18px]">{{ item.materialIcon }}</i>
              <span>{{ item.label }}</span>
            </a>
          </template>
        </ContextMenu>

    <BrowserNavigation
      v-model:view-mode="viewMode"
      :breadcrumbs="breadcrumbs"
      :history-index="historyIndex"
      :history-length="pathHistory.length"
      :allow-create-folder="allowCreateFolder"
      :shortcut-count="shortcuts.length"
      :shortcut-label="messages.common.shortcuts"
      :shortcuts-open="shortcutsOpen"
      @history="goHistory"
      @load-path="loadPath($event, true)"
      @create-folder="createFolder"
      @toggle-shortcuts="shortcutsOpen = !shortcutsOpen"
    />

    <div class="grid h-full min-h-0 min-w-0 items-stretch bg-white" :class="shortcutsOpen ? 'grid-cols-[220px_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)]'">
      <BrowserShortcut
        v-if="shortcutsOpen"
        :shortcuts="shortcuts"
        :title="messages.common.shortcuts"
        :empty-message="messages.common.noShortcuts"
        @open="openShortcut"
      />

      <div class="app-scroll min-h-0 overflow-auto bg-white" :class="viewMode === 'grid' ? 'p-5 pb-10' : 'p-0'">
        <div v-if="loading" class="grid h-full place-items-center text-sm font-semibold text-slate-500">{{ messages.common.loading }}</div>
        <div v-else-if="rows.length === 0" class="grid h-full place-items-center text-sm font-semibold text-slate-500">{{ messages.common.noFiles }}</div>

        <div v-else-if="viewMode === 'grid'" class="grid content-start gap-x-7 gap-y-8 [grid-template-columns:repeat(auto-fill,minmax(124px,124px))]">
          <FileIcon
            v-for="row in rows"
            :key="row.path"
            interactive
            :type="row.type"
            :label="row.name"
            :selected="!folderOnly && selectedRow?.path === row.path"
            :draggable="row.type === 'file'"
            @click="openRow(row)"
            @dblclick="openSelectedRow(row)"
            @contextmenu.prevent.stop="openContextMenu($event, row)"
            @dragstart="startDrag($event, row)"
          />
        </div>

        <div v-else class="grid content-start overflow-hidden border-0">
          <div class="grid h-9 grid-cols-[32px_minmax(0,1fr)_84px_96px_132px] items-center gap-3 border-b border-slate-100 bg-slate-50 px-3 text-xs font-bold text-slate-500">
            <span></span><span>{{ messages.browser.columns.name }}</span><span>{{ messages.browser.columns.format }}</span><span>{{ messages.browser.columns.size }}</span><span>{{ messages.browser.columns.modified }}</span>
          </div>
          <Button
            v-for="row in rows"
            :key="row.path"
            text
            class="!grid !h-11 !grid-cols-[32px_minmax(0,1fr)_84px_96px_132px] !items-center !gap-3 !rounded-none !border-0 !px-3 !py-0 !text-left hover:!bg-sky-50"
            :class="!folderOnly && selectedRow?.path === row.path ? '!bg-sky-100' : '!bg-white'"
            :aria-label="row.name"
            :draggable="row.type === 'file'"
            @click="openRow(row)"
            @dblclick="openSelectedRow(row)"
            @contextmenu.prevent.stop="openContextMenu($event, row)"
            @dragstart="startDrag($event, row)"
          >
            <FileIcon :type="row.type" size="list" />
            <span class="truncate text-sm font-semibold text-slate-700">{{ row.name }}</span>
            <span class="text-xs font-semibold uppercase text-slate-400">{{ row.format }}</span>
            <span class="text-xs font-semibold text-slate-400">{{ row.size }}</span>
            <span class="truncate text-xs font-semibold text-slate-400">{{ formatDate(row.modified_at) }}</span>
          </Button>
        </div>
      </div>
    </div>

    <footer v-if="selectMode" class="flex h-[54px] min-w-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3">
      <span class="min-w-0 truncate text-xs font-semibold text-slate-500">{{ footerText }}</span>
      <div class="inline-flex shrink-0 items-center gap-2">
        <Button outlined size="small" :label="messages.common.cancel" severity="secondary" class="!h-8 !min-h-8 !whitespace-nowrap !px-4 !py-0" @click="$emit('cancel-select')" />
        <Button size="small" :label="folderOnly ? messages.common.select : messages.common.open" class="!h-8 !min-h-8 !min-w-[86px] !whitespace-nowrap !px-4 !py-0" severity="success" :disabled="!canConfirm" @click="confirmSelection">
          <template #icon><i class="material-symbols-rounded">folder_open</i></template>
        </Button>
      </div>
    </footer>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import Button from "primevue/button";
import ContextMenu from "primevue/contextmenu";
import { useStore } from "vuex";
import lodash from "lodash";
import FileIcon from "./browser/Icon.vue";
import BrowserNavigation from "./browser/Navigation.vue";
import BrowserShortcut from "./browser/Shortcut.vue";

const API_BASE = __API_BASE__;
const { sortBy } = lodash;
const store = useStore();

const props = defineProps({
  initialPath: { type: String, default: "" },
  selectMode: { type: Boolean, default: false },
  folderOnly: { type: Boolean, default: false },
  allowCreateFolder: { type: Boolean, default: false },
  modal: { type: Boolean, default: false },
  title: { type: String, default: "" }
});

const emit = defineEmits(["view-file", "convert-file", "create-shortcut", "select-file", "select-folder", "cancel-select"]);

const currentPath = ref("");
const folders = ref([]);
const files = ref([]);
const folderEntries = ref([]);
const fileEntries = ref([]);
const loading = ref(false);
const viewMode = ref("grid");
const pathHistory = ref([""]);
const historyIndex = ref(0);
const contextMenuRef = ref(null);
const selectedContextRow = ref(null);
const selectedRow = ref(null);
const shortcutsOpen = ref(false);
const messages = computed(() => store.getters.messages);
const dateLocale = computed(() => store.getters.dateLocale);
const modalTitle = computed(() => props.title || messages.value.common.filePicker);
const shortcuts = computed(() => store.getters.shortcuts);

const contextMenuItems = computed(() => {
  const row = selectedContextRow.value;
  if (row?.type === "folder") {
    return [{ label: messages.value.browser.createShortcut, materialIcon: "add", command: () => emit("create-shortcut", row) }];
  }
  return [
    { label: messages.value.browser.viewFile, materialIcon: "search", disabled: row?.type !== "file", command: () => row && emit("view-file", row) },
    { label: messages.value.browser.convertFile, materialIcon: "sync_alt", disabled: row?.type !== "file", command: () => row && emit("convert-file", row) }
  ];
});

const breadcrumbs = computed(() => {
  if (!currentPath.value) return [];
  const parts = currentPath.value.split("/").filter(Boolean);
  return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join("/") }));
});

const rows = computed(() => {
  const nextRows = [
    ...(folderEntries.value.length ? folderEntries.value : folders.value.map((name) => ({
      name,
      path: currentPath.value ? `${currentPath.value}/${name}` : name,
      type: "folder",
      format: "folder",
      size: "-",
      modified_at: "",
      sortOrder: 0
    }))).map((item) => ({ ...item, type: item.type || "folder", sortOrder: 0 })),
    ...(fileEntries.value.length ? fileEntries.value : files.value.map((name) => ({
      name,
      path: currentPath.value ? `${currentPath.value}/${name}` : name,
      type: "file",
      format: "file",
      size: "-",
      modified_at: "",
      sortOrder: 1
    }))).map((item) => ({ ...item, type: item.type === "zarr" ? "file" : item.type || "file", sortOrder: 1 }))
  ];
  return sortBy(props.folderOnly ? nextRows.filter((row) => row.type === "folder") : nextRows, ["sortOrder", "name"]);
});

const currentFolder = computed(() => ({
  name: currentPath.value.split("/").filter(Boolean).at(-1) || "HOME",
  path: currentPath.value,
  type: "folder"
}));
const canConfirm = computed(() => props.folderOnly || Boolean(selectedRow.value));
const footerText = computed(() => {
  if (props.folderOnly) return `${messages.value.browser.currentPath}: ${currentPath.value || "HOME"}`;
  return selectedRow.value ? selectedRow.value.path : messages.value.browser.selectFile;
});

async function loadPath(path = "", pushHistory = false) {
  loading.value = true;
  selectedRow.value = null;
  try {
    const response = await fetch(`${API_BASE}/monitor/root?path=${encodeURIComponent(path)}`);
    const payload = await response.json();
    currentPath.value = payload.current_path || path;
    folders.value = payload.folders || [];
    files.value = payload.files || [];
    folderEntries.value = payload.folder_entries || [];
    fileEntries.value = payload.file_entries || [];
    if (pushHistory) pushPath(currentPath.value);
  } finally {
    loading.value = false;
  }
}

function pushPath(path) {
  if (pathHistory.value[historyIndex.value] === path) return;
  pathHistory.value = [...pathHistory.value.slice(0, historyIndex.value + 1), path];
  historyIndex.value = pathHistory.value.length - 1;
}

function goHistory(offset) {
  const nextIndex = historyIndex.value + offset;
  if (nextIndex < 0 || nextIndex >= pathHistory.value.length) return;
  historyIndex.value = nextIndex;
  loadPath(pathHistory.value[nextIndex], false);
}

function openRow(row) {
  if (row.type === "folder") {
    loadPath(row.path, true);
    return;
  }
  if (props.selectMode) selectedRow.value = row;
}

function openShortcut(shortcut) {
  loadPath(shortcut.path || "", true);
}

function openSelectedRow(row) {
  if (!props.selectMode || props.folderOnly) return;
  if (row.type !== "file") return;
  selectedRow.value = row;
  confirmSelection();
}

function confirmSelection() {
  if (props.folderOnly) {
    emit("select-folder", currentFolder.value);
    return;
  }
  if (selectedRow.value) emit("select-file", selectedRow.value);
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(dateLocale.value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function openContextMenu(event, row) {
  if (props.selectMode) return;
  selectedContextRow.value = row;
  contextMenuRef.value?.show(event);
}

function startDrag(event, row) {
  if (row.type !== "file") {
    event.preventDefault();
    return;
  }
  const payload = JSON.stringify(row);
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/x-zarr-file", payload);
  event.dataTransfer.setData("text/plain", row.path);
}

async function createFolder() {
  const name = window.prompt(messages.value.browser.folderNamePrompt);
  if (!name) return;
  loading.value = true;
  try {
    const response = await fetch(`${API_BASE}/monitor/root/folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentPath.value, name })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || messages.value.browser.createFolderFailed);
    await loadPath(currentPath.value, false);
  } catch (err) {
    window.alert(err.message || messages.value.browser.createFolderFailed);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  currentPath.value = props.initialPath;
  pathHistory.value = [props.initialPath];
  loadPath(props.initialPath);
});
</script>

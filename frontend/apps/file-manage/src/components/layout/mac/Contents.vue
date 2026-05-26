<template>
  <main ref="stageRef" class="relative min-h-0 min-w-0 p-[20px_22px_10px]">
    <ContextMenu ref="desktopContextMenuRef" :model="desktopContextMenuItems">
      <template #item="{ item, props }">
        <a v-bind="props.action" class="flex items-center gap-2">
          <i class="material-symbols-rounded icon !text-[18px]">{{ item.materialIcon }}</i>
          <span>{{ item.label }}</span>
        </a>
      </template>
    </ContextMenu>

    <div class="absolute inset-0 z-[3]">
      <div
        v-for="(folder, index) in desktopFolders"
        :key="folder.key"
        class="absolute touch-none select-none"
        :style="desktopIconStyle(folder, index)"
        @pointerdown="startDesktopIconDrag($event, folder, index)"
        @contextmenu.prevent.stop="openDesktopContextMenu($event, folder)"
      >
        <FileIcon
          interactive
          size="desktop"
          :type="folder.iconType"
          :label="folder.label"
        />
      </div>
    </div>

    <WorkerQueue ref="workerQueueRef" />

    <Window
      v-for="windowItem in windows"
      :key="windowItem.key"
      :window-item="windowItem"
      :focused="focusedWindow === windowItem.key"
    >
      <FileBrowser
        v-if="windowItem.type === 'folder'"
        :initial-path="windowItem.initialPath"
        @view-file="openFileView"
        @convert-file="openFileConvert"
        @create-shortcut="createShortcut"
      />
      <DownloadPanel v-else-if="windowItem.key === 'downloads'" />
      <FileDetail
        v-else-if="windowItem.type === 'fileview'"
        :window-key="windowItem.key"
        :file-path="windowItem.filePath"
        :file-root="windowItem.fileRoot || 'data'"
        :message="windowItem.message"
        @loading="setWindowLoading(windowItem, $event)"
      />
      <FileConvert
        v-else-if="windowItem.type === 'fileconvert'"
        :window-key="windowItem.key"
        :file-path="windowItem.filePath"
        :file-root="windowItem.fileRoot || 'data'"
        :message="windowItem.message"
        @loading="setWindowLoading(windowItem, $event)"
      />
    </Window>

    <FileBrowser
      v-if="pickerVisible"
      modal
      select-mode
      :title="pickerTitle"
      :folder-only="Boolean(storagePickerTargetKey)"
      :allow-create-folder="Boolean(storagePickerTargetKey)"
      @select-file="selectFileForPicker"
      @select-folder="selectStorageFolder"
      @cancel-select="closePicker"
    />
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useStore } from "vuex";
import ContextMenu from "primevue/contextmenu";
import DownloadPanel from "../../file/Download.vue";
import FileBrowser from "../../file/Browser.vue";
import FileConvert from "../../file/Convert.vue";
import FileDetail from "../../file/Detail.vue";
import FileIcon from "../../file/browser/Icon.vue";
import Window from "../Window.vue";
import WorkerQueue from "../../worker/Queue.vue";

const store = useStore();
const stageRef = ref(null);
const workerQueueRef = ref(null);
const selectedDesktopFolder = ref(null);
const desktopContextMenuRef = ref(null);
const draggingDesktopIcon = ref(null);
const temporaryDesktopIconPositions = ref({});
let desktopIconDragCleanup;
const desktopGrid = {
  x: 6,
  y: 6,
  width: 118,
  height: 128,
  iconWidth: 104,
  iconHeight: 108
};

defineExpose({ stageRef });

const windows = computed(() => store.getters.windows);
const focusedWindow = computed(() => store.getters.focusedWindow);
const filePickerTargetKey = computed(() => store.getters.filePickerTargetKey);
const storagePickerTargetKey = computed(() => store.getters.storagePickerTargetKey);
const pickerVisible = computed(() => Boolean(filePickerTargetKey.value || storagePickerTargetKey.value));
const messages = computed(() => store.getters.messages);
const pickerTitle = computed(() => (storagePickerTargetKey.value ? messages.value.common.storagePicker : messages.value.common.filePicker));

const desktopFolders = computed(() => [
  { key: "repository", label: messages.value.common.repository, path: "", iconType: "database", shortcut: false },
  { key: "tasks", label: messages.value.worker.title, iconType: "tasks", shortcut: false, action: "tasks" }
]);
const desktopIconPositions = computed(() => store.getters.desktopIconPositions);

const desktopContextMenuItems = computed(() => [
  {
    label: messages.value.common.delete,
    materialIcon: "delete",
    disabled: !selectedDesktopFolder.value?.shortcut,
    command: deleteSelectedDesktopShortcut
  }
]);

function createShortcut(row) {
  store.dispatch("addShortcut", row);
}

function defaultDesktopIconPosition(index) {
  return desktopGridPositionToPixels(defaultDesktopGridPosition(index));
}

function desktopIconPosition(item, index) {
  if (temporaryDesktopIconPositions.value[item.key]) return temporaryDesktopIconPositions.value[item.key];
  return desktopGridPositionToPixels(desktopIconGridPosition(item, index));
}

function desktopIconStyle(item, index) {
  const position = desktopIconPosition(item, index);
  return {
    left: `${position.x}px`,
    top: `${position.y}px`
  };
}

function startDesktopIconDrag(event, item, index) {
  if (event.button !== 0) return;
  event.preventDefault();
  const startX = event.clientX;
  const startY = event.clientY;
  const origin = desktopIconPosition(item, index);
  draggingDesktopIcon.value = item.key;
  temporaryDesktopIconPositions.value = {};
  let moved = false;

  const move = (moveEvent) => {
    const deltaX = moveEvent.clientX - startX;
    const deltaY = moveEvent.clientY - startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) moved = true;
    if (!moved) return;
    const nextPosition = clampDesktopIconPosition({
      x: origin.x + deltaX,
      y: origin.y + deltaY
    });
    temporaryDesktopIconPositions.value = {
      [item.key]: nextPosition
    };
  };
  const up = () => {
    if (!moved) openDesktopItem(item);
    else commitDesktopIconDrop(item);
    draggingDesktopIcon.value = null;
    temporaryDesktopIconPositions.value = {};
    clearDesktopIconDrag();
  };

  clearDesktopIconDrag();
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up, { once: true });
  document.addEventListener("pointercancel", up, { once: true });
  desktopIconDragCleanup = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", up);
  };
}

function clearDesktopIconDrag() {
  if (!desktopIconDragCleanup) return;
  desktopIconDragCleanup();
  desktopIconDragCleanup = undefined;
}

function clampDesktopIconPosition(position) {
  const bounds = stageRef.value?.getBoundingClientRect();
  if (!bounds) return position;
  return {
    x: Math.min(Math.max(position.x, desktopGrid.x), Math.max(bounds.width - desktopGrid.iconWidth, desktopGrid.x)),
    y: Math.min(Math.max(position.y, desktopGrid.y), Math.max(bounds.height - desktopGrid.iconHeight, desktopGrid.y))
  };
}

function defaultDesktopGridPosition(index) {
  return [0, index];
}

function desktopIconGridPosition(item, index) {
  const saved = desktopIconPositions.value[item.key];
  if (Array.isArray(saved?.grid)) return [Math.max(0, Number(saved.grid[0]) || 0), Math.max(0, Number(saved.grid[1]) || 0)];
  if (Number.isFinite(Number(saved?.slot))) return [0, Math.max(0, Number(saved.slot) || 0)];
  if (saved && Number.isFinite(Number(saved.x)) && Number.isFinite(Number(saved.y))) return desktopGridFromPosition(saved);
  return defaultDesktopGridPosition(index);
}

function desktopGridPositionToPixels([column = 0, row = 0]) {
  return {
    x: desktopGrid.x + column * desktopGrid.width,
    y: desktopGrid.y + row * desktopGrid.height
  };
}

function desktopGridFromPosition(position) {
  const column = Math.max(0, Math.round((position.x - desktopGrid.x) / desktopGrid.width));
  const row = Math.max(0, Math.round((position.y - desktopGrid.y) / desktopGrid.height));
  return [column, row];
}

function sameGridPosition(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

function compareGridPosition(left, right) {
  if (left[0] !== right[0]) return left[0] - right[0];
  return left[1] - right[1];
}

function nextGridPosition([column, row]) {
  return [column, row + 1];
}

function commitDesktopIconDrop(item) {
  const targetPosition = temporaryDesktopIconPositions.value[item.key] || desktopIconPosition(item, desktopFolders.value.findIndex((folder) => folder.key === item.key));
  const targetGrid = desktopGridFromPosition(targetPosition);
  const nextGrids = desktopFolders.value.reduce((grids, folder, index) => {
    if (folder.key === item.key) return grids;
    return {
      ...grids,
      [folder.key]: desktopIconGridPosition(folder, index)
    };
  }, {});
  const occupiedTarget = Object.values(nextGrids).some((grid) => sameGridPosition(grid, targetGrid));
  if (occupiedTarget) {
    Object.keys(nextGrids)
      .sort((left, right) => compareGridPosition(nextGrids[right], nextGrids[left]))
      .forEach((key) => {
        if (compareGridPosition(nextGrids[key], targetGrid) >= 0) nextGrids[key] = nextGridPosition(nextGrids[key]);
      });
  }
  nextGrids[item.key] = targetGrid;
  const nextPositions = Object.entries(nextGrids).reduce((positions, [key, grid]) => ({
    ...positions,
    [key]: { grid }
  }), {});
  store.dispatch("setDesktopIconPositions", nextPositions);
}

function openDesktopItem(item) {
  if (item.action === "tasks") {
    workerQueueRef.value?.openPanel();
    return;
  }
  openFolderWindow({ label: item.label, initialPath: item.path || "" });
}

function focusWindow(target) {
  const key = typeof target === "string" ? target : target.key;
  const windowItem = windows.value.find((item) => item.key === key);
  if (!windowItem) return;
  store.dispatch("focusWindow", key);
  writeViewToUrl(key, true);
}

function openWindow(windowItem) {
  if (!windowItem) return;
  store.dispatch("openWindow", windowItem.key);
  focusWindow(windowItem.key);
}

function openFolderWindow(options = {}) {
  store.dispatch("createFolderWindow", options);
  const folderWindow = windows.value.find((item) => item.key === store.state.page.lastCreatedWindowKey);
  openWindow(folderWindow);
}

function openFileView(row) {
  const rowRoot = row.root || "data";
  const existing = windows.value.find((item) => item.type === "fileview" && item.filePath === row.path && (item.fileRoot || "data") === rowRoot && !item.closed);
  if (existing) {
    store.dispatch("patchWindow", { key: existing.key, patch: { minimized: false } });
    focusWindow(existing.key);
    return;
  }

  store.dispatch("createFileViewWindow", row);
  const fileView = windows.value.find((item) => item.key === store.state.page.lastCreatedWindowKey);
  openWindow(fileView);
}

function openFileConvert(row = {}) {
  const rowRoot = row.root || "data";
  const existing = row.path
    ? windows.value.find((item) => item.type === "fileconvert" && item.filePath === row.path && (item.fileRoot || "data") === rowRoot && !item.closed)
    : windows.value.find((item) => item.key === "fileconvert");
  if (existing) {
    if (row.path) store.dispatch("setFileConvertFile", { key: existing.key, row });
    store.dispatch("patchWindow", { key: existing.key, patch: { minimized: false } });
    openWindow(existing);
    return;
  }

  store.dispatch("createFileConvertWindow", row);
  const fileConvert = windows.value.find((item) => item.key === store.state.page.lastCreatedWindowKey);
  openWindow(fileConvert);
}

function selectFileForPicker(row) {
  store.dispatch("setFilePickerSelection", { key: filePickerTargetKey.value, file: row });
  closePicker();
}

function selectStorageFolder(folder) {
  store.dispatch("setStorageFolderSelection", { key: storagePickerTargetKey.value, folder });
  closePicker();
}

function closePicker() {
  if (storagePickerTargetKey.value) store.commit("setStoragePickerTargetKey", "");
  else store.commit("setFilePickerTargetKey", "");
}

function openDesktopContextMenu(event, folder) {
  if (!folder.shortcut) return;
  selectedDesktopFolder.value = folder;
  desktopContextMenuRef.value?.show(event);
}

function deleteSelectedDesktopShortcut() {
  const target = selectedDesktopFolder.value;
  if (!target?.shortcut) return;
  store.dispatch("deleteShortcut", target.path);
  selectedDesktopFolder.value = null;
}

function readViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const nextView = params.get("view") || "fileview";
  return windows.value.some((item) => item.key === nextView) ? nextView : "fileview";
}

function writeViewToUrl(nextView, replace = false) {
  const url = new URL(window.location.href);
  if (nextView === "fileview") url.searchParams.delete("view");
  else url.searchParams.set("view", nextView);
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ fileManageView: nextView }, "", url);
}

function handlePopState() {
  const windowItem = windows.value.find((item) => item.key === readViewFromUrl());
  if (windowItem) openWindow(windowItem);
}

function setWindowLoading(windowItem, loading) {
  store.dispatch("patchWindow", { key: windowItem.key, patch: { loading } });
}

onMounted(() => {
  store.dispatch("loadShortcuts");
  store.dispatch("loadDesktopIconPositions");
  store.commit("setFocusedWindow", "");
  store.commit("setActiveView", readViewFromUrl());
  window.addEventListener("popstate", handlePopState);
});

onBeforeUnmount(() => {
  clearDesktopIconDrag();
  window.removeEventListener("popstate", handlePopState);
});
</script>

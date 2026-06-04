<template>
  <div ref="desktopRef" class="absolute inset-0 z-[3]">
    <ContextMenu ref="desktopContextMenuRef" :model="desktopContextMenuItems">
      <template #item="{ item, props }">
        <a v-bind="props.action" class="flex items-center gap-2">
          <i class="material-symbols-rounded icon !text-lg">{{ item.materialIcon }}</i>
          <span>{{ item.label }}</span>
        </a>
      </template>
    </ContextMenu>

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
</template>

<script setup>
import { computed, inject, onBeforeMount, onBeforeUnmount, onMounted, ref } from "vue";
import { useStore } from "vuex";
import ContextMenu from "primevue/contextmenu";
import FileBrowser from "../file/Browser.vue";
import FileConvert from "../file/Convert.vue";
import FileDetail from "../file/Detail.vue";
import FileIcon from "../file/browser/Icon.vue";
import WorkerQueue from "../worker/Queue.vue";

const store = useStore();
const windowProvider = inject("windowProvider", null);
const desktopRef = ref(null);
const selectedDesktopFolder = ref(null);
const desktopContextMenuRef = ref(null);
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

const messages = computed(() => store.getters.messages);
const desktopIconPositions = computed(() => store.getters.desktopIconPositions);

const desktopFolders = computed(() => [
  { key: "repository", label: messages.value.common.repository, path: "", iconType: "database", shortcut: false },
  { key: "tasks", label: messages.value.worker.title, iconType: "tasks", shortcut: false, action: "tasks" }
]);

const desktopContextMenuItems = computed(() => [
  {
    label: messages.value.common.delete,
    materialIcon: "delete",
    disabled: !selectedDesktopFolder.value?.shortcut,
    command: deleteSelectedDesktopShortcut
  }
]);

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
  const bounds = desktopRef.value?.getBoundingClientRect();
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
    openTaskQueueWindow();
    return;
  }
  const options = { label: item.label, initialPath: item.path || "" };
  if (windowProvider?.open) openFileBrowserWindow(options);
}

function openTaskQueueWindow() {
  if (!windowProvider?.open) return;
  windowProvider.open(
    {
      group: "worker-queue",
      label: messages.value.worker.title,
      icon: "pending_actions",
      description: messages.value.worker.empty,
      x: 886,
      y: 26,
      width: 380,
      height: 420,
      minWidth: 360,
      minHeight: 320
    },
    {
      content: WorkerQueue
    }
  );
}

function openFileBrowserWindow(options = {}) {
  windowProvider.open(
    {
      group: "repository",
      label: options.label,
      icon: "folder",
      description: messages.value.common.repository
    },
    {
      content: FileBrowser,
      contentProps: {
        initialPath: options.initialPath || ""
      },
      contentEvents: {
        "view-file": openFileDetailWindow,
        "convert-file": openFileConvertWindow,
        "create-shortcut": createShortcut
      }
    }
  );
}

function openFileDetailWindow(row = {}) {
  const rowRoot = row.root || "";
  const group = `fileview:${rowRoot}:${row.path}`;
  windowProvider.open(
    {
      group,
      label: row.name || row.path?.split("/").pop() || "FileView",
      icon: "quick_reference_all",
      description: row.path || "",
      filePath: row.path || "",
      ...(rowRoot ? { fileRoot: rowRoot } : {}),
      message: "",
      loading: false
    },
    {
      content: FileDetail,
      contentProps: (windowItem) => ({
        filePath: windowItem.filePath,
        fileRoot: windowItem.fileRoot,
        message: windowItem.message || ""
      }),
      contentEvents: (windowItem) => ({
        loading: (loading) => windowProvider.patch(windowItem.key, { loading })
      })
    }
  );
}

function openFileConvertWindow(row = {}) {
  const rowRoot = row.root || "";
  const group = row.path ? `fileconvert:${rowRoot}:${row.path}` : "fileconvert";
  windowProvider.open(
    {
      group,
      label: row.name || row.path?.split("/").pop() || "FileConvert",
      icon: "sync_alt",
      description: row.path || "Resample files and convert products to Zarr.",
      filePath: row.path || "",
      ...(rowRoot ? { fileRoot: rowRoot } : {}),
      message: "",
      loading: false
    },
    {
      content: FileConvert,
      contentProps: (windowItem) => ({
        filePath: windowItem.filePath || "",
        fileRoot: windowItem.fileRoot,
        message: windowItem.message || ""
      }),
      contentEvents: (windowItem) => ({
        loading: (loading) => windowProvider.patch(windowItem.key, { loading })
      })
    }
  );
}

function createShortcut(row) {
  store.dispatch("addShortcut", row);
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

onBeforeMount(() => {
  store.dispatch("loadShortcuts");
});

onMounted(() => {
  store.dispatch("loadDesktopIconPositions");
});

onBeforeUnmount(() => {
  clearDesktopIconDrag();
});
</script>

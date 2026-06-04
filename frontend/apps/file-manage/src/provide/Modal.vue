<template>
  <slot></slot>

  <div
    v-if="hasOverlay"
    class="absolute inset-0 z-[80] bg-slate-950/35 backdrop-blur-[1px]"
    :style="{ zIndex: overlayZIndex }"
    @pointerdown.self="focusTopWindow"
  ></div>

  <section
    v-for="dialog in dialogs"
    :key="dialog.key"
    :ref="(element) => setDialogRef(dialog.key, element)"
    v-show="!dialog.minimized"
    class="desktop-window absolute grid min-h-0 min-w-0 grid-rows-[58px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-700/25 bg-white/85 shadow-[0_26px_90px_rgba(8,20,28,0.38)] backdrop-blur-2xl"
    :class="{
      maximized: dialog.maximized,
      'shadow-[0_30px_100px_rgba(8,20,28,0.44)]': focusedKey === dialog.key
    }"
    :style="dialogStyle(dialog)"
    :aria-label="dialog.label"
    @pointerdown="focusDialog(dialog.key)"
  >
    <header
      class="flex min-w-0 cursor-grab select-none items-center gap-3 border-b border-slate-800/10 bg-white/95 px-4 py-2.5 active:cursor-grabbing"
      @pointerdown="startDrag($event, dialog)"
    >
      <div class="inline-flex min-w-0 flex-1 items-center gap-2.5">
        <Badge value="8" size="xlarge" severity="success">
          <i class="material-symbols-rounded icon">{{ dialog.icon }}</i>
        </Badge>
        <div class="grid min-w-0 gap-px">
          <strong class="truncate text-sm">{{ dialog.label }}</strong>
          <small class="truncate text-xs text-slate-500">{{ dialog.description }}</small>
        </div>
      </div>
      <div class="inline-flex flex-none items-center gap-0.5" @pointerdown.stop>
        <Button class="!h-8 !w-8 !p-0 !text-slate-500 hover:!bg-cyan-900/10 hover:!text-slate-900" text rounded aria-label="Minimize" @click="minimizeDialog(dialog.key)">
          <template #icon>
            <i class="material-symbols-rounded icon !text-xl">remove</i>
          </template>
        </Button>
        <Button class="!h-8 !w-8 !p-0 !text-slate-500 hover:!bg-cyan-900/10 hover:!text-slate-900" text rounded aria-label="Maximize" @click="toggleMaximize(dialog.key)">
          <template #icon>
            <i class="material-symbols-rounded icon !text-xl">{{ dialog.maximized ? "filter_none" : "crop_square" }}</i>
          </template>
        </Button>
        <Button class="!h-8 !w-8 !p-0 !text-slate-500 hover:!bg-red-500 hover:!text-white" text rounded aria-label="Close" @click="closeDialog(dialog.key)">
          <template #icon>
            <i class="material-symbols-rounded icon !text-xl">close</i>
          </template>
        </Button>
      </div>
    </header>

    <section class="window-content min-h-0 min-w-0 overflow-hidden p-0">
      <component
        :is="dialog.content"
        v-if="dialog.content"
        v-bind="contentProps(dialog)"
        v-on="contentEvents(dialog)"
      />
    </section>

    <div
      v-if="!dialog.maximized"
      class="absolute bottom-0 right-0 z-[5] h-4 w-4 cursor-nwse-resize bg-transparent"
      aria-label="Resize"
      @pointerdown.stop.prevent="startResize($event, dialog)"
    ></div>
  </section>
</template>

<script setup>
import { computed, markRaw, onBeforeUnmount, provide, ref } from "vue";
import Button from "primevue/button";
import Badge from "primevue/badge";
import lodash from "lodash";

const { uniqueId, omitBy, isUndefined } = lodash;
const dialogs = ref([]);
const focusedKey = ref("");
const nextZIndex = ref(80);
const dialogRefs = new Map();
let pointerCleanup;

const hasOverlay = computed(() => dialogs.value.some((dialog) => dialog.overlay && !dialog.minimized));
const overlayZIndex = computed(() => {
  const overlayDialogs = dialogs.value.filter((dialog) => dialog.overlay && !dialog.minimized);
  if (!overlayDialogs.length) return 80;
  return Math.max(80, Math.max(...overlayDialogs.map((dialog) => Number(dialog.zIndex) || 0)) - 1);
});

const provider = {
  open: openDialog,
  close: closeDialog,
  patch: patchDialog,
  focus: focusDialog,
  minimize: minimizeDialog,
  restore: restoreDialog,
  toggleMaximize
};

provide("windowProvider", provider);
provide("modal", provider);

function openDialog(windowOptions = {}, contentOptions, legacyBindings = {}) {
  const normalized = normalizeContent(contentOptions, legacyBindings);
  const key = windowOptions.key || createDialogKey();
  const placement = placeDialog(windowOptions);
  const existing = findExistingDialog(windowOptions, key);
  if (existing && windowOptions.preventDuplicate !== false) {
    patchDialog(existing.key, {
      ...dialogPatch(windowOptions),
      content: normalized.content,
      contentProps: normalized.contentProps,
      contentEvents: normalized.contentEvents,
      minimized: false
    });
    focusDialog(existing.key);
    return existing.key;
  }

  const dialog = {
    key,
    group: windowOptions.group || "",
    label: windowOptions.label || windowOptions.title || "Window",
    icon: windowOptions.icon || "open_in_new",
    description: windowOptions.description || "",
    filePath: windowOptions.filePath || "",
    fileRoot: windowOptions.fileRoot,
    message: windowOptions.message || "",
    loading: Boolean(windowOptions.loading),
    ...placement,
    minWidth: placement.minWidth,
    minHeight: placement.minHeight,
    maxWidth: windowOptions.maxWidth,
    maxHeight: windowOptions.maxHeight,
    zIndex: ++nextZIndex.value,
    overlay: Boolean(windowOptions.overlay),
    minimized: false,
    maximized: Boolean(windowOptions.maximized),
    content: normalized.content,
    contentProps: normalized.contentProps,
    contentEvents: normalized.contentEvents
  };
  dialogs.value = [...dialogs.value, dialog];
  focusedKey.value = key;
  return key;
}

function normalizeContent(contentOptions, legacyBindings = {}) {
  if (contentOptions?.content) {
    return {
      content: markRaw(contentOptions.content),
      contentProps: contentOptions.contentProps || {},
      contentEvents: contentOptions.contentEvents || {}
    };
  }
  return {
    content: contentOptions ? markRaw(contentOptions) : null,
    contentProps: legacyBindings.props || {},
    contentEvents: legacyBindings.events || {}
  };
}

function contentProps(dialog) {
  const props = typeof dialog.contentProps === "function" ? dialog.contentProps(dialog) : dialog.contentProps || {};
  return { ...props, windowKey: dialog.key };
}

function contentEvents(dialog) {
  if (typeof dialog.contentEvents === "function") return dialog.contentEvents(dialog);
  return dialog.contentEvents || {};
}

function findExistingDialog(options = {}, key) {
  if (options.group) return dialogs.value.find((dialog) => dialog.group === options.group);
  if (options.key) return dialogs.value.find((dialog) => dialog.key === key);
  return null;
}

function createDialogKey() {
  if (globalThis.crypto?.randomUUID) return `dialog-${globalThis.crypto.randomUUID()}`;
  return uniqueId("dialog-");
}

function closeDialog(key) {
  dialogs.value = dialogs.value.filter((dialog) => dialog.key !== key);
  dialogRefs.delete(key);
  if (focusedKey.value === key) focusTopWindow();
}

function patchDialog(key, patch = {}) {
  dialogs.value = dialogs.value.map((dialog) => (dialog.key === key ? { ...dialog, ...patch } : dialog));
}

function focusDialog(key) {
  const target = dialogs.value.find((dialog) => dialog.key === key);
  if (!target) return;
  const zIndex = ++nextZIndex.value;
  patchDialog(key, { zIndex, minimized: false });
  focusedKey.value = key;
}

function focusTopWindow() {
  const visibleDialogs = dialogs.value.filter((dialog) => !dialog.minimized);
  if (!visibleDialogs.length) {
    focusedKey.value = "";
    return;
  }
  const topDialog = visibleDialogs.reduce((top, dialog) => (dialog.zIndex > top.zIndex ? dialog : top));
  focusDialog(topDialog.key);
}

function minimizeDialog(key) {
  patchDialog(key, { minimized: true });
  if (focusedKey.value === key) focusTopWindow();
}

function restoreDialog(key) {
  patchDialog(key, { minimized: false });
  focusDialog(key);
}

function toggleMaximize(key) {
  const target = dialogs.value.find((dialog) => dialog.key === key);
  if (!target) return;
  patchDialog(key, { maximized: !target.maximized });
  focusDialog(key);
}

function dialogPatch(options = {}) {
  return omitBy({
    group: options.group,
    label: options.label || options.title,
    icon: options.icon,
    description: options.description,
    filePath: options.filePath,
    fileRoot: options.fileRoot,
    message: options.message,
    loading: options.loading,
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    maxWidth: options.maxWidth,
    maxHeight: options.maxHeight,
    overlay: options.overlay,
    maximized: options.maximized
  }, isUndefined);
}

function dialogStyle(dialog) {
  if (dialog.maximized) return { zIndex: dialog.zIndex };
  return {
    left: `${dialog.x}px`,
    top: `${dialog.y}px`,
    width: `${dialog.width}px`,
    height: `${dialog.height}px`,
    minWidth: `${dialog.minWidth}px`,
    minHeight: `${dialog.minHeight}px`,
    maxWidth: dialog.maxWidth ? `${dialog.maxWidth}px` : undefined,
    maxHeight: dialog.maxHeight ? `${dialog.maxHeight}px` : undefined,
    zIndex: dialog.zIndex
  };
}

function placeDialog(options = {}) {
  const bounds = stageBounds();
  const minWidth = options.minWidth ?? 560;
  const minHeight = options.minHeight ?? 380;
  const width = clampNumber(options.width ?? defaultWidth(bounds), minWidth, options.maxWidth ?? Math.max(bounds.width - 24, minWidth));
  const height = clampNumber(options.height ?? defaultHeight(bounds), minHeight, options.maxHeight ?? Math.max(bounds.height - 24, minHeight));
  const offset = (dialogs.value.filter((dialog) => !dialog.minimized).length % 8) * 28;
  const centeredX = Math.round((bounds.width - width) / 2) + offset;
  const centeredY = Math.round((bounds.height - height) / 2) + offset;
  return clampedToBounds({
    width,
    height,
    minWidth,
    minHeight,
    x: options.x ?? centeredX,
    y: options.y ?? centeredY
  }, bounds);
}

function defaultWidth(bounds) {
  return Math.min(980, Math.max(640, bounds.width * 0.76));
}

function defaultHeight(bounds) {
  return Math.min(640, Math.max(420, bounds.height * 0.76));
}

function stageBounds() {
  const element = document.querySelector(".mac-desktop main") || document.querySelector(".mac-desktop") || document.body;
  const bounds = element?.getBoundingClientRect?.();
  return {
    width: Math.max(0, bounds?.width || window.innerWidth || 1024),
    height: Math.max(0, bounds?.height || window.innerHeight || 768)
  };
}

function setDialogRef(key, element) {
  if (element) dialogRefs.set(key, element);
  else dialogRefs.delete(key);
}

function startDrag(event, dialog) {
  if (dialog.maximized || event.button !== 0) return;
  event.preventDefault();
  focusDialog(dialog.key);
  const startX = event.clientX;
  const startY = event.clientY;
  const origin = { x: dialog.x, y: dialog.y, width: dialog.width, height: dialog.height };
  bindPointer((moveEvent) => {
    patchDialog(dialog.key, clampedDialogPatch(dialog.key, {
      ...origin,
      x: origin.x + moveEvent.clientX - startX,
      y: origin.y + moveEvent.clientY - startY
    }));
  });
}

function startResize(event, dialog) {
  if (event.button !== 0) return;
  event.preventDefault();
  focusDialog(dialog.key);
  const startX = event.clientX;
  const startY = event.clientY;
  const origin = { x: dialog.x, y: dialog.y, width: dialog.width, height: dialog.height };
  bindPointer((moveEvent) => {
    patchDialog(dialog.key, clampedDialogPatch(dialog.key, {
      ...origin,
      width: origin.width + moveEvent.clientX - startX,
      height: origin.height + moveEvent.clientY - startY
    }));
  });
}

function bindPointer(move) {
  clearPointerBinding();
  const up = () => clearPointerBinding();
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up, { once: true });
  document.addEventListener("pointercancel", up, { once: true });
  pointerCleanup = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", up);
  };
}

function clearPointerBinding() {
  if (!pointerCleanup) return;
  pointerCleanup();
  pointerCleanup = undefined;
}

function clampedDialogPatch(key, next) {
  const stage = dialogRefs.get(key)?.offsetParent;
  if (!stage) return next;
  const bounds = stage.getBoundingClientRect();
  const dialog = dialogs.value.find((item) => item.key === key);
  return clampedToBounds({
    ...next,
    minWidth: next.minWidth ?? dialog?.minWidth,
    minHeight: next.minHeight ?? dialog?.minHeight,
    maxWidth: dialog?.maxWidth,
    maxHeight: dialog?.maxHeight
  }, bounds);
}

function clampedToBounds(next, bounds) {
  const minWidth = next.minWidth ?? 560;
  const minHeight = next.minHeight ?? 380;
  const maxWidth = next.maxWidth ?? Math.max(bounds.width - 24, minWidth);
  const maxHeight = next.maxHeight ?? Math.max(bounds.height - 24, minHeight);
  const width = Math.min(Math.max(next.width, minWidth), maxWidth);
  const height = Math.min(Math.max(next.height, minHeight), maxHeight);
  return {
    width,
    height,
    minWidth,
    minHeight,
    x: Math.min(Math.max(next.x, 12), Math.max(bounds.width - width - 12, 12)),
    y: Math.min(Math.max(next.y, 12), Math.max(bounds.height - height - 12, 12))
  };
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(Number(value) || min, min), max);
}

onBeforeUnmount(() => {
  clearPointerBinding();
});
</script>

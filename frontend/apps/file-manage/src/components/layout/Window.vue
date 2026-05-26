<template>
  <section
    ref="windowRef"
    v-show="!windowItem.closed && !windowItem.minimized"
    class="desktop-window absolute grid min-h-0 min-w-0 grid-rows-[58px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-700/25 bg-white/85 shadow-[0_26px_90px_rgba(8,20,28,0.38)] backdrop-blur-2xl"
    :class="{
      maximized: windowItem.maximized,
      'shadow-[0_30px_100px_rgba(8,20,28,0.44)]': focused
    }"
    :style="windowStyle"
    :aria-label="windowItem.label"
    @pointerdown="focusWindow"
  >
    <header
      class="flex min-w-0 cursor-grab select-none items-center gap-3 border-b border-slate-800/10 bg-white/95 px-4 py-2.5 active:cursor-grabbing"
      @pointerdown="startDrag"
    >
      <div class="inline-flex min-w-0 flex-1 items-center gap-2.5">
        <Badge value="8" size="xlarge" severity="success">
          <i class="material-symbols-rounded icon">{{ windowItem.icon }}</i>
        </Badge>
        <div class="grid min-w-0 gap-px">
          <strong class="truncate text-sm">{{ windowItem.label }}</strong>
          <small class="truncate text-xs text-slate-500">{{ windowItem.description }}</small>
        </div>
      </div>
      <div class="inline-flex flex-none items-center gap-0.5" @pointerdown.stop>
        <Button class="!h-8 !w-8 !p-0 !text-slate-500 hover:!bg-cyan-900/10 hover:!text-slate-900" text rounded aria-label="Minimize" @click="minimizeWindow">
          <template #icon>
            <i class="material-symbols-rounded icon !text-[19px]">remove</i>
          </template>
        </Button>
        <Button class="!h-8 !w-8 !p-0 !text-slate-500 hover:!bg-cyan-900/10 hover:!text-slate-900" text rounded aria-label="Maximize" @click="toggleMaximize">
          <template #icon>
            <i class="material-symbols-rounded icon !text-[19px]">{{ windowItem.maximized ? "filter_none" : "crop_square" }}</i>
          </template>
        </Button>
        <Button class="!h-8 !w-8 !p-0 !text-slate-500 hover:!bg-red-500 hover:!text-white" text rounded aria-label="Close" @click="closeWindow">
          <template #icon>
            <i class="material-symbols-rounded icon !text-[19px]">close</i>
          </template>
        </Button>
      </div>
    </header>
    <section class="window-content min-h-0 min-w-0 overflow-hidden p-0">
      <slot></slot>
    </section>
    <div
      v-if="!windowItem.maximized"
      class="absolute bottom-0 right-0 z-[5] h-4 w-4 cursor-nwse-resize bg-transparent"
      aria-label="Resize"
      @pointerdown.stop.prevent="startResize"
    ></div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useStore } from "vuex";
import Button from "primevue/button";
import Badge from "primevue/badge";

const props = defineProps({
  windowItem: {
    type: Object,
    required: true
  },
  focused: {
    type: Boolean,
    default: false
  }
});

const store = useStore();
const windowRef = ref(null);
let activePointerCleanup;

const windowStyle = computed(() => {
  if (props.windowItem.maximized) {
    return { zIndex: props.windowItem.zIndex };
  }

  return {
    left: `${props.windowItem.x}px`,
    top: `${props.windowItem.y}px`,
    width: `${props.windowItem.width}px`,
    height: `${props.windowItem.height}px`,
    zIndex: props.windowItem.zIndex
  };
});

function focusWindow() {
  store.dispatch("focusWindow", props.windowItem.key);
}

async function closeWindow() {
  await store.dispatch("closeWindowItem", props.windowItem.key);
}

function minimizeWindow() {
  store.dispatch("minimizeWindow", props.windowItem.key);
  store.dispatch("focusTopVisibleWindow");
}

function toggleMaximize() {
  store.dispatch("toggleMaximize", props.windowItem.key);
  focusWindow();
}

function startDrag(event) {
  if (props.windowItem.maximized || event.button !== 0) return;
  event.preventDefault();
  focusWindow();
  const startX = event.clientX;
  const startY = event.clientY;
  const originX = props.windowItem.x;
  const originY = props.windowItem.y;
  const originWidth = props.windowItem.width;
  const originHeight = props.windowItem.height;
  bindPointer(event, (moveEvent) => {
    patchClampedWindow({
      x: originX + moveEvent.clientX - startX,
      y: originY + moveEvent.clientY - startY,
      width: originWidth,
      height: originHeight
    });
  });
}

function startResize(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  focusWindow();
  const startX = event.clientX;
  const startY = event.clientY;
  const originWidth = props.windowItem.width;
  const originHeight = props.windowItem.height;
  const originX = props.windowItem.x;
  const originY = props.windowItem.y;
  bindPointer(event, (moveEvent) => {
    patchClampedWindow({
      x: originX,
      y: originY,
      width: originWidth + moveEvent.clientX - startX,
      height: originHeight + moveEvent.clientY - startY
    });
  });
}

function bindPointer(event, move) {
  clearPointerBinding();
  windowRef.value?.setPointerCapture?.(event?.pointerId);
  const up = () => clearPointerBinding();
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up, { once: true });
  document.addEventListener("pointercancel", up, { once: true });
  activePointerCleanup = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", up);
  };
}

function clearPointerBinding() {
  if (!activePointerCleanup) return;
  activePointerCleanup();
  activePointerCleanup = undefined;
}

function stageElement() {
  return windowRef.value?.offsetParent || null;
}

function clampedWindowPatch(next) {
  const stage = stageElement();
  if (!stage || props.windowItem.maximized) return next;
  const bounds = stage.getBoundingClientRect();
  const width = Math.min(Math.max(next.width, 560), Math.max(bounds.width - 24, 560));
  const height = Math.min(Math.max(next.height, 380), Math.max(bounds.height - 24, 380));
  return {
    width,
    height,
    x: Math.min(Math.max(next.x, 12), Math.max(bounds.width - width - 12, 12)),
    y: Math.min(Math.max(next.y, 12), Math.max(bounds.height - height - 12, 12))
  };
}

function patchClampedWindow(next) {
  store.dispatch("patchWindow", {
    key: props.windowItem.key,
    patch: clampedWindowPatch(next)
  });
}

function clampWindow() {
  if (props.windowItem.maximized) return;
  store.dispatch("patchWindow", {
    key: props.windowItem.key,
    patch: clampedWindowPatch(props.windowItem)
  });
}

onMounted(() => {
  clampWindow();
  window.addEventListener("resize", clampWindow);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", clampWindow);
  clearPointerBinding();
});
</script>

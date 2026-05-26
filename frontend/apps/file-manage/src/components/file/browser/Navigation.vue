<template>
  <header class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-200 bg-white px-3">
    <div class="inline-flex items-center gap-1">
      <Button text rounded class="!h-9 !w-9 !p-0 !text-slate-500 hover:!bg-slate-100" aria-label="Back" :disabled="historyIndex <= 0" @click="$emit('history', -1)">
        <template #icon><i class="material-symbols-rounded icon !text-[22px]">chevron_left</i></template>
      </Button>
      <Button text rounded class="!h-9 !w-9 !p-0 !text-slate-500 hover:!bg-slate-100" aria-label="Forward" :disabled="historyIndex >= historyLength - 1" @click="$emit('history', 1)">
        <template #icon><i class="material-symbols-rounded icon !text-[22px]">chevron_right</i></template>
      </Button>
    </div>

    <nav class="flex h-8 min-w-0 items-center gap-1 overflow-hidden rounded-md bg-slate-50 px-2 text-sm" aria-label="Current folder">
      <i class="material-symbols-rounded icon !text-[18px] text-slate-600">home</i>
      <Button text label="HOME" class="!h-7 !min-w-0 !rounded !px-2 !py-0 !text-sm !font-semibold !text-slate-700 hover:!bg-slate-200" @click="$emit('load-path', '')" />
      <template v-for="crumb in leadingCrumbs" :key="crumb.path">
        <i class="material-symbols-rounded icon !text-[16px] text-slate-400">chevron_right</i>
        <Button text class="!h-7 !min-w-0 !rounded !px-2 !py-0 !text-sm !font-semibold !text-slate-700 hover:!bg-slate-200" @click="$emit('load-path', crumb.path)">
          <span class="max-w-32 truncate">{{ crumb.name }}</span>
        </Button>
      </template>
      <template v-if="hiddenCrumbs.length">
        <i class="material-symbols-rounded icon !text-[16px] text-slate-400">chevron_right</i>
        <Button text rounded class="!h-7 !w-7 !p-0 !text-slate-500 hover:!bg-slate-200" aria-label="More folders" @click="toggleHiddenCrumbs">
          <template #icon><i class="material-symbols-rounded icon !text-[18px]">more_horiz</i></template>
        </Button>
        <Menu ref="hiddenCrumbMenuRef" :model="hiddenCrumbMenuItems" popup />
      </template>
      <template v-for="crumb in trailingCrumbs" :key="crumb.path">
        <i class="material-symbols-rounded icon !text-[16px] text-slate-400">chevron_right</i>
        <Button text class="!h-7 !min-w-0 !rounded !px-2 !py-0 !text-sm !font-semibold !text-slate-700 hover:!bg-slate-200" @click="$emit('load-path', crumb.path)">
          <span class="max-w-36 truncate">{{ crumb.name }}</span>
        </Button>
      </template>
    </nav>

    <div class="inline-flex items-center gap-1">
      <Button
        text
        rounded
        class="!h-8 !w-8 !p-0 hover:!bg-slate-100"
        :class="shortcutsOpen ? '!bg-yellow-50 !text-yellow-500' : '!text-slate-600'"
        :aria-label="shortcutLabel"
        @click="$emit('toggle-shortcuts')"
      >
        <template #icon>
          <span class="relative grid place-items-center">
            <i class="material-symbols-rounded icon !text-[20px]" :class="{ filled: shortcutsOpen }">kid_star</i>
          </span>
        </template>
      </Button>
      <Button v-if="allowCreateFolder" text rounded class="!h-8 !w-8 !p-0 !text-slate-600 hover:!bg-slate-100" aria-label="Create folder" @click="$emit('create-folder')">
        <template #icon><i class="material-symbols-rounded icon !text-[20px]">create_new_folder</i></template>
      </Button>
      <SelectButton
        :model-value="viewMode"
        :options="viewOptions"
        option-label="label"
        option-value="value"
        data-key="value"
        :allow-empty="false"
        class="file-view-mode"
        @update:model-value="$emit('update:viewMode', $event)"
      >
        <template #option="{ option }">
   
            <i class="material-symbols-rounded icon !text-[19px]">{{ option.icon }}</i>

        </template>
      </SelectButton>
    </div>
  </header>
</template>

<script setup>
import { computed, ref } from "vue";
import Button from "primevue/button";
import Menu from "primevue/menu";
import SelectButton from "primevue/selectbutton";

const props = defineProps({
  breadcrumbs: { type: Array, default: () => [] },
  historyIndex: { type: Number, default: 0 },
  historyLength: { type: Number, default: 1 },
  viewMode: { type: String, default: "grid" },
  allowCreateFolder: { type: Boolean, default: false },
  shortcutCount: { type: Number, default: 0 },
  shortcutLabel: { type: String, default: "Shortcuts" },
  shortcutsOpen: { type: Boolean, default: false }
});

const emit = defineEmits(["history", "load-path", "create-folder", "toggle-shortcuts", "update:viewMode"]);
const hiddenCrumbMenuRef = ref(null);

const viewOptions = [
  { label: "Grid", value: "grid", icon: "grid_view" },
  { label: "List", value: "list", icon: "view_list" }
];

const leadingCrumbs = computed(() => {
  if (props.breadcrumbs.length <= 4) return props.breadcrumbs;
  return props.breadcrumbs.slice(0, 1);
});

const hiddenCrumbs = computed(() => {
  if (props.breadcrumbs.length <= 4) return [];
  return props.breadcrumbs.slice(1, -3);
});

const trailingCrumbs = computed(() => {
  if (props.breadcrumbs.length <= 4) return [];
  return props.breadcrumbs.slice(-3);
});

const hiddenCrumbMenuItems = computed(() => hiddenCrumbs.value.map((crumb) => ({
  label: crumb.name,
  command: () => emit("load-path", crumb.path)
})));

function toggleHiddenCrumbs(event) {
  hiddenCrumbMenuRef.value?.toggle(event);
}
</script>

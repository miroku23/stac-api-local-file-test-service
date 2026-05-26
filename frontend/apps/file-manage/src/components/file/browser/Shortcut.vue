<template>
  <aside class="grid h-full min-h-0 self-stretch overflow-hidden border-r border-slate-200 bg-slate-50">
    <header class="flex h-10 items-center gap-2 border-b border-slate-200 px-3 text-xs font-bold text-slate-600">
      <i class="material-symbols-rounded icon !text-[18px] text-sky-500">kid_star</i>
      <span>{{ title }}</span>
    </header>
    <div class="app-scroll grid min-h-0 content-start gap-1 overflow-y-auto overflow-x-hidden p-2" style="height: calc(100% - 40px)">
      <Message v-if="!shortcuts.length" severity="secondary" size="small" class="!m-0">{{ emptyMessage }}</Message>
      <Button
        v-for="shortcut in shortcuts"
        :key="shortcut.path"
        text
        class="!grid !h-10 !min-h-10 !shrink-0 !grid-cols-[24px_minmax(0,1fr)] !items-center !justify-start !gap-2 !rounded-md !px-2 !py-0 !text-left hover:!bg-white"
        @click="$emit('open', shortcut)"
      >
        <i class="material-symbols-rounded filled icon !text-[22px] !leading-none text-sky-400">folder</i>
        <span class="truncate text-xs font-semibold text-slate-700">{{ shortcut.label }}</span>
      </Button>
    </div>
  </aside>
</template>

<script setup>
import Button from "primevue/button";
import Message from "primevue/message";

defineProps({
  shortcuts: { type: Array, default: () => [] },
  title: { type: String, default: "Shortcuts" },
  emptyMessage: { type: String, default: "No shortcut folders." }
});

defineEmits(["open"]);
</script>

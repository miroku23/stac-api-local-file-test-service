<template>
  <aside class="flex h-full min-h-0 flex-col self-stretch overflow-hidden border-r border-slate-200 bg-slate-50">
    <header class="flex h-10 shrink-0 items-center gap-2 border-b border-slate-200 px-3 text-xs font-bold text-slate-600">
      <i class="material-symbols-rounded icon !text-lg text-sky-500">kid_star</i>
      <span>{{ title }}</span>
    </header>
    <div class="app-scroll flex min-h-0 flex-1 flex-col justify-start gap-1 overflow-y-auto overflow-x-hidden p-2">
      <Message v-if="!shortcuts.length" severity="secondary" size="small" class="!m-0">{{ emptyMessage }}</Message>
      <div
        v-for="shortcut in shortcuts"
        :key="shortcut.path"
        class="group grid h-10 min-h-10 shrink-0 grid-cols-[minmax(0,1fr)_28px] items-center gap-1 rounded-md px-2 hover:bg-white focus-within:bg-white"
      >
        <Button
          text
          class="!grid !h-10 !min-h-10 !min-w-0 !grid-cols-[24px_minmax(0,1fr)] !items-center !justify-start !gap-2 !rounded-md !px-0 !py-0 !text-left hover:!bg-transparent"
          @click="$emit('open', shortcut)"
        >
          <i class="material-symbols-rounded filled icon !text-2xl !leading-none text-sky-400">folder</i>
          <span class="truncate text-xs font-semibold text-slate-700">{{ shortcut.label }}</span>
        </Button>
        <Button
          text
          rounded
          severity="secondary"
          class="!h-7 !w-7 !p-0 !text-slate-400 opacity-0 transition-opacity hover:!bg-red-50 hover:!text-red-500 group-hover:opacity-100 group-focus-within:opacity-100"
          :aria-label="deleteLabel"
          @click.stop="$emit('delete', shortcut)"
        >
          <template #icon>
            <i class="material-symbols-rounded icon !text-lg">delete</i>
          </template>
        </Button>
      </div>
    </div>
  </aside>
</template>

<script setup>
import Button from "primevue/button";
import Message from "primevue/message";

defineProps({
  shortcuts: { type: Array, default: () => [] },
  title: { type: String, default: "Shortcuts" },
  emptyMessage: { type: String, default: "No shortcut folders." },
  deleteLabel: { type: String, default: "Delete shortcut" }
});

defineEmits(["open", "delete"]);
</script>

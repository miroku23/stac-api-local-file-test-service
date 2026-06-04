<template>
  <DataTable
    v-model:selection="selectionModel"
    :value="rows"
    data-key="path"
    selection-mode="single"
    resizable-columns
    column-resize-mode="expand"
    removable-sort
    scrollable
    scroll-height="flex"
    size="small"
    class="file-browser-table h-full"
    :row-class="rowClass"
    @row-click="$emit('open', $event.data)"
    @row-dblclick="$emit('open-selected', $event.data)"
    @row-contextmenu="$emit('contextmenu', $event)"
  >
    <Column field="name" :header="columns.name" sortable style="min-width: 240px">
      <template #body="{ data }">
        <div
          class="flex min-w-0 items-center gap-3"
          :draggable="data.type === 'file'"
          @dragstart="$emit('dragstart', $event, data)"
        >
          <FileIcon :type="data.type" size="list" />
          <span class="truncate text-sm font-semibold text-slate-700">{{ data.name }}</span>
        </div>
      </template>
    </Column>

    <Column field="format" :header="columns.format" sortable style="width: 120px; min-width: 96px">
      <template #body="{ data }">
        <span class="text-xs font-semibold uppercase text-slate-400">{{ data.format }}</span>
      </template>
    </Column>

    <Column field="size_bytes" :header="columns.size" sortable style="width: 128px; min-width: 104px">
      <template #body="{ data }">
        <span class="text-xs font-semibold text-slate-400">{{ data.size }}</span>
      </template>
    </Column>

    <Column field="modified_at" :header="columns.modified" sortable style="width: 180px; min-width: 150px">
      <template #body="{ data }">
        <span class="truncate text-xs font-semibold text-slate-400">{{ formatDate(data.modified_at) }}</span>
      </template>
    </Column>
  </DataTable>
</template>

<script setup>
import { computed } from "vue";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import FileIcon from "./Icon.vue";

const props = defineProps({
  rows: { type: Array, default: () => [] },
  selected: { type: Object, default: null },
  columns: { type: Object, required: true },
  dateLocale: { type: String, default: "en-US" }
});

const emit = defineEmits(["update:selected", "open", "open-selected", "contextmenu", "dragstart"]);

const selectionModel = computed({
  get: () => props.selected,
  set: (value) => emit("update:selected", value)
});

function rowClass(row) {
  return row.type === "folder" ? "file-browser-row is-folder" : "file-browser-row";
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(props.dateLocale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
</script>

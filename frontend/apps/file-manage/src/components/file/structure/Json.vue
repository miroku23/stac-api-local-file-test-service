<template>
  <div class="grid gap-3">
    <div class="flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
      <span class="bg-slate-100 px-2 py-1">JSON {{ summary.root_type }}</span>
      <span v-if="summary.key_count !== undefined" class="bg-slate-100 px-2 py-1">{{ summary.key_count }} keys</span>
      <span v-if="summary.length !== undefined" class="bg-slate-100 px-2 py-1">{{ summary.length }} items</span>
    </div>
    <pre class="max-h-none overflow-auto border border-slate-200 bg-slate-950 p-3 text-xs leading-relaxed text-slate-100"><code>{{ detail.content }}</code></pre>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  detail: {
    type: Object,
    default: () => ({})
  }
});

const summary = computed(() => props.detail.summary || {});
</script>

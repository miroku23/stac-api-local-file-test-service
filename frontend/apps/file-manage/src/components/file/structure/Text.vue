<template>
  <div class="grid gap-3">
    <div class="flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
      <span class="bg-slate-100 px-2 py-1">{{ detail.line_count || 0 }} lines</span>
      <span v-if="detail.truncated" class="bg-amber-100 px-2 py-1 text-amber-800">Preview truncated</span>
    </div>
    <pre class="whitespace-pre-wrap break-words border border-[var(--zarr-border)] bg-slate-50 p-3 text-xs leading-relaxed text-slate-800"><code>{{ detail.content }}</code></pre>
  </div>
</template>

<script setup>
defineProps({
  detail: {
    type: Object,
    default: () => ({})
  }
});
</script>

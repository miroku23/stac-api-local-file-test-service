<template>
  <p v-if="!jobs.length" class="m-0 px-2 py-5 text-center text-xs font-semibold text-slate-500">
    {{ messages.worker.empty }}
  </p>

  <article v-for="job in jobs" :key="job.id" class="grid gap-2 border border-slate-200 bg-white p-3">
    <div class="flex min-w-0 items-start justify-between gap-2">
      <div class="min-w-0">
        <strong class="block truncate text-sm text-slate-800">{{ job.title }}</strong>
        <span class="block truncate text-xs text-slate-500">{{ job.fileName }}</span>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <span class="rounded px-2 py-1 text-xs font-bold" :class="statusClass(job.status)">
          {{ statusLabel(job.status) }}
        </span>
        <button
          v-if="canCancelJob(job)"
          type="button"
          class="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-50"
          :disabled="job.status === 'canceling'"
          :title="messages.common.cancel"
          :aria-label="messages.common.cancel"
          @click="$emit('cancel', job)"
        >
          <i class="material-symbols-rounded icon !text-base">close</i>
        </button>
      </div>
    </div>
    <p v-if="job.message" class="m-0 line-clamp-2 text-xs leading-relaxed text-slate-600">{{ job.message }}</p>
    <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <div class="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div class="h-full rounded-full transition-all" :class="barClass(job.status)" :style="{ width: progressWidth(job) }"></div>
      </div>
      <span class="text-xs font-bold text-slate-500">{{ progressText(job) }}</span>
    </div>
  </article>
</template>

<script setup>
import { computed } from "vue";
import { useStore } from "vuex";

const props = defineProps({
  jobs: { type: Array, default: () => [] }
});

defineEmits(["cancel"]);

const store = useStore();
const messages = computed(() => store.getters.messages);

function statusLabel(status) {
  return messages.value.worker.status[status] || messages.value.worker.status.running;
}

function statusClass(status) {
  return {
    success: "bg-emerald-50 text-emerald-700",
    error: "bg-rose-50 text-rose-700",
    canceled: "bg-slate-100 text-slate-600",
    canceling: "bg-amber-50 text-amber-700",
    queued: "bg-slate-100 text-slate-600",
    running: "bg-sky-50 text-sky-700"
  }[status] || "bg-sky-50 text-sky-700";
}

function barClass(status) {
  return {
    success: "bg-emerald-500",
    error: "bg-rose-500",
    canceled: "bg-slate-400",
    canceling: "bg-amber-500",
    queued: "bg-slate-400",
    running: "bg-sky-500"
  }[status] || "bg-sky-500";
}

function progressValue(job) {
  const value = Number(job.progress);
  if (Number.isFinite(value)) return Math.max(0, Math.min(100, value));
  return job.status === "success" || job.status === "error" ? 100 : 0;
}

function progressWidth(job) {
  return `${progressValue(job)}%`;
}

function progressText(job) {
  return `${Math.round(progressValue(job))}%`;
}

function canCancelJob(job) {
  return ["queued", "running", "canceling", "error"].includes(job.status);
}
</script>

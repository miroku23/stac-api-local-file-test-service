<template>
  <section class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-white">
    <Tabs v-model:value="activeTab" class="worker-tabs">
      <TabList>
        <Tab value="download">
          <span class="worker-tab-label">
            <i class="material-symbols-rounded icon">cloud_download</i>
            <span>{{ messages.worker.download }}</span>
            <Badge :value="downloadJobCount" severity="secondary" />
          </span>
        </Tab>
        <Tab value="zarr">
          <span class="worker-tab-label">
            <i class="material-symbols-rounded icon">database</i>
            <span>Zarr</span>
            <Badge :value="conversionJobs.length" severity="contrast" />
          </span>
        </Tab>
      </TabList>
      <TabPanels class="!p-0">
        <TabPanel value="download" class="!p-0">
          <div class="grid max-h-[320px] gap-2 overflow-auto p-2">
            <Message severity="secondary" size="small" class="!m-0">{{ messages.worker.empty }}</Message>
          </div>
        </TabPanel>
        <TabPanel value="zarr" class="!p-0">
          <DataView :value="conversionJobs" data-key="id" class="worker-queue">
            <template #empty>
              <div class="p-2">
                <Message severity="secondary" size="small" class="!m-0">{{ messages.worker.empty }}</Message>
              </div>
            </template>
            <template #list="{ items }">
              <div class="grid max-h-[320px] gap-2 overflow-auto p-2">
                <article v-for="job in items" :key="job.id" class="grid gap-2 border border-slate-200 bg-white p-3">
                  <div class="flex min-w-0 items-start justify-between gap-2">
                    <div class="min-w-0">
                      <strong class="block truncate text-sm text-slate-800">{{ job.title }}</strong>
                      <span class="block truncate text-xs text-slate-500">{{ job.fileName }}</span>
                    </div>
                    <div class="flex shrink-0 items-center gap-1">
                      <Tag :severity="statusSeverity(job.status)" :value="statusLabel(job.status)" />
                      <Button
                        v-if="canCancelJob(job)"
                        text
                        rounded
                        class="!h-6 !w-6 !p-0 !text-slate-400 hover:!bg-rose-50 hover:!text-rose-600"
                        :disabled="job.status === 'canceling'"
                        aria-label="Cancel job"
                        @click="cancelConversionJob(job)"
                      >
                        <template #icon><i class="material-symbols-rounded icon !text-base">close</i></template>
                      </Button>
                    </div>
                  </div>
                  <p v-if="job.message" class="m-0 line-clamp-2 text-xs leading-relaxed text-slate-600">{{ job.message }}</p>
                  <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <ProgressBar :value="progressValue(job)" :show-value="false" class="!h-1.5" />
                    <span class="text-xs font-bold text-slate-500">{{ progressText(job) }}</span>
                  </div>
                </article>
              </div>
            </template>
          </DataView>
        </TabPanel>
      </TabPanels>
    </Tabs>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useStore } from "vuex";
import Badge from "primevue/badge";
import Button from "primevue/button";
import DataView from "primevue/dataview";
import Message from "primevue/message";
import ProgressBar from "primevue/progressbar";
import Tab from "primevue/tab";
import TabList from "primevue/tablist";
import TabPanel from "primevue/tabpanel";
import TabPanels from "primevue/tabpanels";
import Tabs from "primevue/tabs";
import Tag from "primevue/tag";
import { useToast } from "primevue/usetoast";

const API_BASE = __API_BASE__;

const store = useStore();
const toast = useToast();
const activeTab = ref("zarr");
const completedJobTimers = new Map();
const notifiedCompletedJobIds = new Set();
let jobEventSource = null;

const conversionJobs = computed(() => store.getters.conversionJobs);
const downloadJobCount = computed(() => 0);
const messages = computed(() => store.getters.messages);

onMounted(() => {
  loadConversionJobs();
  connectConversionJobStream();
});

onBeforeUnmount(() => {
  jobEventSource?.close();
  jobEventSource = null;
  for (const timer of completedJobTimers.values()) clearTimeout(timer);
  completedJobTimers.clear();
});

async function loadConversionJobs() {
  try {
    const response = await fetch(`${API_BASE}/convert/jobs`);
    const payload = await response.json();
    if (response.ok) await handleIncomingConversionJobs(payload.jobs || []);
  } catch {
    store.dispatch("replaceConversionJobs", []);
  }
}

function connectConversionJobStream() {
  if (typeof EventSource === "undefined") return;
  jobEventSource?.close();
  jobEventSource = new EventSource(`${API_BASE}/convert/jobs/stream`);
  jobEventSource.addEventListener("jobs", (event) => {
    try {
      handleIncomingConversionJobs(JSON.parse(event.data));
    } catch {
      // Next stream message refreshes the queue.
    }
  });
}

async function handleIncomingConversionJobs(jobs) {
  const incomingJobs = Array.isArray(jobs) ? jobs : [];
  const previousStatuses = new Map(store.getters.conversionJobs.map((job) => [job.id, job.status]));
  await store.dispatch("replaceConversionJobs", incomingJobs);
  for (const job of store.getters.conversionJobs) {
    if (job.status !== "success") continue;
    const previousStatus = previousStatuses.get(job.id);
    if (!previousStatus || previousStatus === "success") continue;
    notifyConversionCompleted(job);
  }
}

function notifyConversionCompleted(job) {
  if (!job?.id || notifiedCompletedJobIds.has(job.id)) return;
  notifiedCompletedJobIds.add(job.id);
  toast.add({
    severity: "success",
    summary: messages.value.worker.completedSummary,
    detail: job.fileName || messages.value.worker.completedDetail,
    life: 3000
  });
  const timer = setTimeout(() => {
    store.dispatch("dismissConversionJob", job.id);
    completedJobTimers.delete(job.id);
  }, 3000);
  completedJobTimers.set(job.id, timer);
}

function statusLabel(status) {
  return messages.value.worker.status[status] || messages.value.worker.status.running;
}

function statusSeverity(status) {
  return {
    success: "success",
    error: "danger",
    canceled: "secondary",
    canceling: "warn",
    queued: "secondary",
    running: "info"
  }[status] || "info";
}

function progressValue(job) {
  const value = Number(job.progress);
  if (Number.isFinite(value)) return Math.max(0, Math.min(100, value));
  return job.status === "success" || job.status === "error" ? 100 : 0;
}

function progressText(job) {
  return `${Math.round(progressValue(job))}%`;
}

function canCancelJob(job) {
  return ["queued", "running", "canceling", "error"].includes(job.status);
}

async function cancelConversionJob(job) {
  if (!job?.id || job.status === "canceling") return;
  store.dispatch("upsertConversionJob", {
    ...job,
    status: "canceling",
    message: messages.value.worker.cancelingMessage
  });
  try {
    const response = await fetch(`${API_BASE}/convert/jobs/${job.id}/cancel`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.job) store.dispatch("upsertConversionJob", payload.job);
  } catch {
    store.dispatch("upsertConversionJob", {
      ...job,
      status: "error",
      message: messages.value.worker.cancelFailed
    });
  }
}
</script>

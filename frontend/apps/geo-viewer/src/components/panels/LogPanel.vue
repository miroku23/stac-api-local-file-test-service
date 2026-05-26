<template>
  <section id="logPanel" class="geo-panel log-panel" :class="{ collapsed }">
    <header class="panel-head">
      <strong>Logs</strong>
      <button class="icon-button" type="button" :aria-label="collapsed ? 'Show Logs panel' : 'Hide Logs panel'" @click="toggle">
        <span class="material-symbols-rounded icon">{{ collapsed ? "keyboard_arrow_down" : "keyboard_arrow_up" }}</span>
      </button>
    </header>
    <div class="panel-body log-body">
      <div class="error-line">{{ error }}</div>
      <div ref="listEl" class="log-list" @scroll="onScroll">
        <p v-if="logs.length === 0" class="log-empty">No logs</p>
        <div v-else :style="{ height: `${topPad}px` }"></div>
        <div v-for="log in visibleLogs" :key="`${log.createdAt}-${log.message}`" class="log-entry" :data-level="log.level">
          <p>[{{ formatTime(log.createdAt) }} - {{ log.level }}] {{ log.message }}</p>
          <small v-if="log.detail">{{ log.detail }}</small>
        </div>
        <div v-if="logs.length > 0" :style="{ height: `${bottomPad}px` }"></div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { store } from "../../store";

const listEl = ref(null);
const itemHeight = 56;
const overscan = 10;
const scrollTop = ref(0);
const viewportHeight = ref(260);
const logs = computed(() => store.state.logs.items);
const error = computed(() => store.state.error);
const collapsed = computed(() => store.getters.panelCollapsed("logPanel"));

const startIndex = computed(() => Math.max(0, Math.floor(scrollTop.value / itemHeight) - overscan));
const visibleCount = computed(() => Math.ceil(viewportHeight.value / itemHeight) + overscan * 2);
const endIndex = computed(() => Math.min(logs.value.length, startIndex.value + visibleCount.value));
const visibleLogs = computed(() => logs.value.slice(startIndex.value, endIndex.value));
const topPad = computed(() => startIndex.value * itemHeight);
const bottomPad = computed(() => Math.max(0, (logs.value.length - endIndex.value) * itemHeight));

function onScroll() {
  if (!listEl.value) return;
  scrollTop.value = listEl.value.scrollTop;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function toggle() {
  store.commit("togglePanel", "logPanel");
}

onMounted(() => {
  store.dispatch("logs/init")
    .catch(() => {});
  if (listEl.value) viewportHeight.value = listEl.value.clientHeight || viewportHeight.value;
});
</script>

<template>
  <section id="statusPanel" class="geo-panel status-panel" :class="{ collapsed }">
    <header class="panel-head">
      <strong>Running</strong>
      <button class="icon-button" type="button" :aria-label="collapsed ? 'Show Running panel' : 'Hide Running panel'" @click="toggle">
        <span class="material-symbols-rounded icon">{{ collapsed ? "keyboard_arrow_down" : "keyboard_arrow_up" }}</span>
      </button>
    </header>
    <div class="panel-body">
      <div class="metric-row">
        <span class="state-pill">{{ uiStatus }}</span>
        <span>{{ performance.fps }} fps / {{ performance.frameMs }} ms</span>
      </div>
      <div class="metric-row">
        <span>WebGL</span>
        <span>{{ ui.webglInfo }}</span>
      </div>
      <div class="metric-row">
        <span>GPU</span>
        <span>{{ ui.gpuInfo }}</span>
      </div>
      <div class="metric-row zoom-metrics">
        <span>Zoom <b>{{ metrics.zoom }}</b></span>
        <span>Scale <b>{{ metrics.scale }}</b></span>
        <span>Res <b>{{ metrics.resolution }}</b></span>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { store } from "../../store";

const ui = computed(() => store.state);
const uiStatus = computed(() => store.getters.statusLabel);
const performance = computed(() => ui.value.performance);
const metrics = computed(() => ui.value.viewMetrics);
const collapsed = computed(() => store.getters.panelCollapsed("statusPanel"));

function toggle() {
  store.commit("togglePanel", "statusPanel");
}
</script>

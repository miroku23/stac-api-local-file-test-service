<template>
  <div class="geo-host">
    <ViewerStage />
    <StatusPanel />
    <LayerPanel />
    <MapSettingsPanel />
    <LogPanel />
    <SatelliteTimeline />
    <ClickReadout />
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from "vue";
import LayerPanel from "./panels/LayerPanel.vue";
import LogPanel from "./panels/LogPanel.vue";
import MapSettingsPanel from "./panels/MapSettingsPanel.vue";
import StatusPanel from "./panels/StatusPanel.vue";
import SatelliteTimeline from "./SatelliteTimeline.vue";
import ClickReadout from "./ClickReadout.vue";
import ViewerStage from "./ViewerStage.vue";
import { mountGeoViewerEngine } from "../engine/useGeoViewerEngine.js";

let cleanup = null;

onMounted(() => {
  cleanup = mountGeoViewerEngine();
});

onBeforeUnmount(() => {
  if (cleanup) cleanup();
});
</script>

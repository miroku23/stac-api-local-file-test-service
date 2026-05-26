<template>
  <div id="clickReadout" class="click-readout">
    <div class="readout-marker" :style="markerStyle"></div>
    <div class="readout-bubble" :style="bubbleStyle">
      <span>{{ readout.value }}</span>
      <button class="readout-close" type="button" aria-label="Close value readout" @click="close">
        <span class="material-symbols-rounded icon">close</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { store } from "../store";

const bubbleBottom = ref(12);
let resizeObserver = null;

const readout = computed(() => store.state.readout);
const markerStyle = computed(() => ({
  display: readout.value.markerVisible ? "block" : "none",
  left: `${readout.value.markerX}px`,
  top: `${readout.value.markerY}px`
}));
const bubbleStyle = computed(() => ({
  display: readout.value.visible ? "flex" : "none",
  left: "12px",
  top: "auto",
  bottom: `${bubbleBottom.value}px`
}));

function syncBubblePosition() {
  const layerPanel = document.getElementById("layerPanel");
  const layerRect = layerPanel?.getBoundingClientRect();
  bubbleBottom.value = layerRect && layerRect.height > 0
    ? Math.max(12, window.innerHeight - layerRect.top + 8)
    : 12;
}

function close() {
  store.commit("closeReadout");
}

onMounted(() => {
  syncBubblePosition();
  const layerPanel = document.getElementById("layerPanel");
  if (window.ResizeObserver && layerPanel) {
    resizeObserver = new ResizeObserver(syncBubblePosition);
    resizeObserver.observe(layerPanel);
  }
  window.addEventListener("resize", syncBubblePosition);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("resize", syncBubblePosition);
});
</script>

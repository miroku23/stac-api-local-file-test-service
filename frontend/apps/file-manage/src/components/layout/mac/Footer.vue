<template>
  <DockBar :windows="dockWindows" @open="openWindow" />
</template>

<script setup>
import { computed } from "vue";
import { useStore } from "vuex";
import DockBar from "../Dock.vue";

const store = useStore();
const dockWindows = computed(() => store.getters.dockWindows);

function openWindow(windowItem) {
  if (!windowItem) return;
  store.dispatch("openWindow", windowItem.key);
  store.dispatch("focusWindow", windowItem.key);
  writeViewToUrl(windowItem.key, true);
}

function writeViewToUrl(nextView, replace = false) {
  const url = new URL(window.location.href);
  if (nextView === "fileview") url.searchParams.delete("view");
  else url.searchParams.set("view", nextView);
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ fileManageView: nextView }, "", url);
}
</script>

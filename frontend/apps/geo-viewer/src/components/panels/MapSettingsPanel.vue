<template>
  <section id="mapSettingsPanel" class="geo-panel map-settings-panel" :class="{ collapsed }">
    <header class="panel-head">
      <strong>Map</strong>
      <button class="icon-button" type="button" :aria-label="collapsed ? 'Show Map panel' : 'Hide Map panel'" @click="toggle">
        <span class="material-symbols-rounded icon">{{ collapsed ? "keyboard_arrow_down" : "keyboard_arrow_up" }}</span>
      </button>
    </header>
    <div class="panel-body">
      <div class="row"><label>Projection</label><select id="projection" v-model="projection">
        <option value="geoOrthographic">Orthographic</option>
        <option value="geoMercator">Mercator</option>
        <option value="geoEquirectangular">Equirectangular</option>
      </select></div>
      <div class="row"><label>Base Map</label><select id="basemap" v-model="basemap">
        <option value="none">None</option>
        <option value="osm">OSM</option>
        <option value="satellite">Satellite</option>
      </select></div>
      <div class="row"><label>Time</label><select id="timeMode" v-model="timeMode">
        <option value="local">Local</option>
        <option value="utc">UTC</option>
      </select></div>
      <div class="row"><label>Grid</label><input id="gridToggle" v-model="gridVisible" type="checkbox" /><span class="mono">{{ gridVisible ? "show" : "hide" }}</span></div>
      <div class="row"><label>CoastLine</label><input id="coastToggle" v-model="coastVisible" type="checkbox" /><span class="mono">{{ coastVisible ? "show" : "hide" }}</span></div>
      <div class="row"><label>Night Boundary</label><input id="nightBoundaryToggle" v-model="nightBoundaryVisible" type="checkbox" /><span class="mono">{{ nightBoundaryVisible ? "show" : "hide" }}</span></div>
      <div class="row"><label>Timezone</label><input id="timezoneToggle" v-model="timezoneVisible" type="checkbox" /><span class="mono">{{ timezoneVisible ? "show" : "hide" }}</span></div>
    </div>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { setProjection, setRenderingOption, store, viewerState } from "../../store";

const projection = computed({
  get: () => viewerState.rendering.projection,
  set: (value) => setProjection(value)
});
const timeMode = computed({
  get: () => viewerState.rendering.timeMode,
  set: (value) => setRenderingOption("timeMode", value)
});
const basemap = computed({
  get: () => viewerState.rendering.basemap,
  set: (value) => setRenderingOption("basemap", value)
});
const gridVisible = computed({
  get: () => viewerState.rendering.gridVisible,
  set: (value) => setRenderingOption("gridVisible", value)
});
const coastVisible = computed({
  get: () => viewerState.rendering.coastVisible,
  set: (value) => setRenderingOption("coastVisible", value)
});
const nightBoundaryVisible = computed({
  get: () => viewerState.rendering.nightBoundaryVisible,
  set: (value) => setRenderingOption("nightBoundaryVisible", value)
});
const timezoneVisible = computed({
  get: () => viewerState.rendering.timezoneVisible,
  set: (value) => setRenderingOption("timezoneVisible", value)
});
const collapsed = computed(() => store.getters.panelCollapsed("mapSettingsPanel"));

function toggle() {
  store.commit("togglePanel", "mapSettingsPanel");
}
</script>

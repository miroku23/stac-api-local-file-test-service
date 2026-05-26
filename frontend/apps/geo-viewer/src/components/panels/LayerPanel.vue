<template>
  <section id="layerPanel" class="geo-panel layer-panel" :class="{ collapsed }">
    <header class="panel-head">
      <strong>Layers</strong>
      <button class="icon-button" type="button" :aria-label="collapsed ? 'Show Layers panel' : 'Hide Layers panel'" @click="toggle">
        <span class="material-symbols-rounded icon">{{ collapsed ? "keyboard_arrow_down" : "keyboard_arrow_up" }}</span>
      </button>
    </header>
    <div class="panel-body">
      <div class="segmented">
        <button type="button" :class="{ active: tab === 'visual' }" @click="tab = 'visual'"><span class="material-symbols-rounded icon">air</span>Visual</button>
        <button type="button" :class="{ active: tab === 'overlay' }" @click="tab = 'overlay'"><span class="material-symbols-rounded icon">layers</span>Overlay</button>
        <button type="button" :class="{ active: tab === 'products' }" @click="tab = 'products'"><span class="material-symbols-rounded icon">satellite_alt</span>Products</button>
        <button type="button" :class="{ active: tab === 'satellite' }" @click="tab = 'satellite'"><span class="material-symbols-rounded icon">satellite_alt</span>Satellite</button>
      </div>
      <div v-show="tab === 'visual'" class="layer-section">
        <div class="row"><label>file</label><span class="mono">{{ layerInfo.fileName }}</span></div>
        <div class="row"><label>shape</label><span class="mono">{{ layerInfo.shape }}</span></div>
        <div class="row"><label>animation</label><input id="pause" v-model="animationEnabled" type="checkbox" /><span class="mono">on/off</span></div>
        <div class="row"><label>field</label><select id="flowKind" v-model="flowKind">
          <option value="none">none</option>
          <option value="WIND">wind</option>
          <option value="CURRENT">current</option>
        </select></div>
        <div id="particlesRow" class="row"><label>particles</label><input id="particles" v-model.number="particlesScale" type="range" min="0.5" max="1.8" step="0.05" /><span id="particlesValue" class="mono">5000</span></div>
        <div id="fadeRow" class="row"><label>fade</label><input id="fade" v-model.number="fade" type="range" min="0.0005" max="0.12" step="0.0005" /><span id="fadeValue" class="mono">{{ fade }}</span></div>
        <div id="alphaRow" class="row"><label>alpha</label><input id="alpha" v-model.number="alpha" type="range" min="0.01" max="0.35" step="0.003" /><span id="alphaValue" class="mono">{{ alpha }}</span></div>
        <div class="row"><label>quality</label><span id="quality" class="mono">100%</span></div>
      </div>
      <div v-show="tab === 'overlay'" class="layer-section">
        <div class="row"><label>overlay</label><select id="overlay" v-model="overlay">
          <option value="none">none</option>
          <option value="WIND">wind speed</option>
          <option value="TEMP">temp</option>
          <option value="RH">rh</option>
        </select></div>
        <div v-if="overlay !== 'none'" class="row"><label>colorbar</label><select v-model="overlayColorbar">
          <option v-for="option in colorbarOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select></div>
        <div v-if="overlay !== 'none'" class="colorbar-preview" :style="{ background: colorbarGradient(overlayColorbar) }"></div>
      </div>
      <div v-show="tab === 'products'" class="layer-section">
        <div class="row"><label>product</label><select id="product" v-model="product">
          <option value="none">none</option>
          <option value="AEH">AEH</option>
          <option value="PM25">PM25</option>
          <option value="TEMPO_O3">TEMPO O3</option>
        </select></div>
        <div v-if="product !== 'none'" class="row"><label>colorbar</label><select v-model="productColorbar">
          <option v-for="option in colorbarOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select></div>
        <div v-if="product !== 'none'" class="colorbar-preview" :style="{ background: colorbarGradient(productColorbar) }"></div>
      </div>
      <div v-show="tab === 'satellite'" class="layer-section">
        <div class="row"><label>satellite</label><input id="satelliteToggle" v-model="satelliteVisible" type="checkbox" /><span class="mono">{{ satelliteVisible ? "show" : "hide" }}</span></div>
        <div class="satellite-buttons" role="group" aria-label="Satellite TLE">
          <button
            v-for="option in satelliteOptions"
            :key="option.value"
            type="button"
            :class="{ active: satelliteKinds.includes(option.value) }"
            @click="toggleSatellite(option.value)"
          >
            <span class="satellite-swatch" :style="{ backgroundColor: satelliteColors[option.value] || option.color }"></span>
            {{ option.label }}
            <small>{{ option.type }}</small>
          </button>
        </div>
        <div class="orbit-range">
          <label>orbit</label>
          <div class="orbit-buttons" role="group" aria-label="Orbit time range">
            <button
              v-for="hours in orbitHourOptions"
              :key="hours"
              type="button"
              :class="{ active: satelliteOrbitHours === hours }"
              @click="satelliteOrbitHours = hours"
            >
              {{ hours }}h
            </button>
          </div>
        </div>
      </div>
      <div class="hidden-controls">
        <div id="colorbar"></div><div id="scaleTicks"></div><span id="overlayValue">-</span>
        <input id="tone" v-model.number="tone" type="range" min="0.25" max="1.15" step="0.01" /><span id="toneValue">{{ tone }}</span>
        <input id="curve" v-model.number="curve" type="range" min="0.75" max="2.2" step="0.01" /><span id="curveValue">{{ curve }}</span>
        <input id="overlayAlpha" v-model.number="overlayAlpha" type="range" min="0.12" max="0.58" step="0.01" /><span id="overlayAlphaValue">{{ overlayAlpha }}</span>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { COLORBAR_OPTIONS, COLORBARS } from "../../config/colorbars.js";
import { FIELD_META } from "../../config/datasets.js";
import { setRenderingOption, store, viewerState } from "../../store";

const tab = ref("visual");
const collapsed = computed(() => store.getters.panelCollapsed("layerPanel"));
const layerInfo = computed(() => store.state.layerInfo);

function toggle() {
  store.commit("togglePanel", "layerPanel");
}

function optionModel(key) {
  return computed({
    get: () => viewerState.rendering[key],
    set: (value) => setRenderingOption(key, value)
  });
}

const flowKind = optionModel("flowKind");
const overlay = optionModel("overlay");
const product = optionModel("product");
const colorbarOptions = COLORBAR_OPTIONS;
const overlayColorbar = computed({
  get: () => viewerState.rendering.overlayColorbar || FIELD_META[overlay.value]?.colorbar || "viridis",
  set: (value) => setRenderingOption("overlayColorbar", value)
});
const productColorbar = computed({
  get: () => viewerState.rendering.productColorbar || FIELD_META[product.value]?.colorbar || "viridis",
  set: (value) => setRenderingOption("productColorbar", value)
});

watch(overlay, (value) => {
  setRenderingOption("overlayColorbar", FIELD_META[value]?.colorbar || null);
});

watch(product, (value) => {
  setRenderingOption("productColorbar", FIELD_META[value]?.colorbar || null);
});
const satelliteKinds = optionModel("satelliteKinds");
const satelliteColors = optionModel("satelliteColors");
const satelliteOrbitHours = optionModel("satelliteOrbitHours");
const satelliteVisible = optionModel("satelliteVisible");
const animationEnabled = optionModel("animationEnabled");
const particlesScale = optionModel("particlesScale");
const fade = optionModel("fade");
const alpha = optionModel("alpha");
const tone = optionModel("tone");
const curve = optionModel("curve");
const overlayAlpha = optionModel("overlayAlpha");
const satelliteOptions = [
  { value: "GK2", label: "GEMS", name: "GEO-KOMPSAT-2B", type: "GEO", color: "#6ee7b7" },
  { value: "TEMPO", label: "TEMPO", name: "INTELSAT 40E", type: "GEO", color: "#ffd670" },
  { value: "SENTINEL5P", label: "S5P", name: "SENTINEL-5P", type: "LEO", color: "#93c5fd" }
];
const orbitHourOptions = [3, 6, 12, 24];

function toggleSatellite(value) {
  if (!satelliteKinds.value.includes(value) && !satelliteColors.value[value]) {
    satelliteColors.value = { ...satelliteColors.value, [value]: randomSatelliteColor() };
  }
  const next = satelliteKinds.value.includes(value)
    ? satelliteKinds.value.filter((kind) => kind !== value)
    : [...satelliteKinds.value, value];
  satelliteKinds.value = next;
  satelliteVisible.value = next.length > 0;
}

function randomSatelliteColor() {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue} 78% 68%)`;
}

function colorbarGradient(code, range = null, bounds = null) {
  const stops = (COLORBARS[code] || COLORBARS.viridis).stops;
  const [start, end] = normalizedRange(range, bounds);
  const steps = Math.max(2, stops.length * 3);
  return `linear-gradient(90deg, ${Array.from({ length: steps }, (_, index) => {
    const p = steps <= 1 ? 0 : index / (steps - 1);
    const color = sampleStops(stops, start + (end - start) * p);
    return `rgb(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])}) ${p * 100}%`;
  }).join(", ")})`;
}

function normalizedRange(range = null, bounds = null) {
  if (!range || !bounds) return [0, 1];
  const span = Number(bounds[1]) - Number(bounds[0]);
  if (!Number.isFinite(span) || span <= 0) return [0, 1];
  const start = Math.max(0, Math.min(1, (Number(range[0]) - Number(bounds[0])) / span));
  const end = Math.max(start, Math.min(1, (Number(range[1]) - Number(bounds[0])) / span));
  return [start, end];
}

function sampleStops(stops, t) {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(x));
  const f = x - index;
  const a = stops[index];
  const b = stops[index + 1];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f
  ];
}

function formatRange(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return Math.abs(number) >= 100 ? number.toFixed(0) : number.toFixed(2).replace(/\.?0+$/, "");
}
</script>

<template>
  <section class="form-section">
    <div class="section-title">
      <h2>{{ text.area }}</h2>
      <span>N/W/S/E order</span>
    </div>
    <div class="preset-row">
      <Button v-for="preset in presets" :key="preset.name" size="small" severity="secondary" outlined type="button" :label="preset.name" @click="$emit('apply-preset', preset)" />
    </div>
    <div class="form-grid area-grid">
      <label class="field north">
        <span>North</span>
        <InputNumber v-model="form.n" :min="limits.latMin" :max="limits.latMax" :min-fraction-digits="0" :max-fraction-digits="6" fluid />
      </label>
      <label class="field west">
        <span>West</span>
        <InputNumber v-model="form.w" :min="limits.lonMin" :max="limits.lonMax" :min-fraction-digits="0" :max-fraction-digits="6" fluid />
      </label>
      <label class="field east">
        <span>East</span>
        <InputNumber v-model="form.e" :min="limits.lonMin" :max="limits.lonMax" :min-fraction-digits="0" :max-fraction-digits="6" fluid />
      </label>
      <label class="field south">
        <span>South</span>
        <InputNumber v-model="form.s" :min="limits.latMin" :max="limits.latMax" :min-fraction-digits="0" :max-fraction-digits="6" fluid />
      </label>
    </div>
  </section>
</template>

<script setup>
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";

defineProps({
  form: { type: Object, required: true },
  text: { type: Object, required: true },
  limits: { type: Object, required: true },
  presets: { type: Array, default: () => [] }
});

defineEmits(["apply-preset"]);
</script>

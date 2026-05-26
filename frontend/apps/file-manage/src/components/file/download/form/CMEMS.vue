<template>
  <section class="form-section">
    <div class="section-title">
      <h2>{{ text.dataSelection }}</h2>
      <div class="section-actions">
        <span>{{ requestSummary }}</span>
      </div>
    </div>

    <div class="form-grid">
      <label class="field">
        <span>Date</span>
        <DatePicker v-model="form.date" date-format="yy-mm-dd" show-icon fluid />
      </label>
      <label class="field">
        <span>Time (UTC)</span>
        <Select v-model="form.time" :options="timeOptions" option-label="label" option-value="value" fluid />
      </label>
      <label class="field">
        <span>{{ categoryLabel }}</span>
        <Select v-model="form.category" :options="categoryOptions" option-label="label" option-value="value" fluid />
      </label>
    </div>

    <p class="section-note">{{ text.cmemsNote }}</p>
  </section>

  <section v-if="showDepth" class="form-section">
    <div class="section-title">
      <h2>{{ text.depth }}</h2>
      <span>{{ text.defaultSurfaceDepth }}</span>
    </div>
    <div class="form-grid">
      <label class="field">
        <span>Minimum depth (m)</span>
        <InputNumber v-model="form.minimumDepth" :min="0" :max="6000" :min-fraction-digits="0" :max-fraction-digits="12" fluid />
      </label>
      <label class="field">
        <span>Maximum depth (m)</span>
        <InputNumber v-model="form.maximumDepth" :min="0" :max="6000" :min-fraction-digits="0" :max-fraction-digits="12" fluid />
      </label>
    </div>
  </section>

  <DownloadArea :form="form" :text="text" :limits="areaLimits" :presets="areaPresets" @apply-preset="$emit('apply-area-preset', $event)" />

  <section v-if="variableOptions.length" class="form-section">
    <div class="section-title">
      <h2>{{ text.variables }}</h2>
      <span>{{ text.selectedCount(form.variables.length) }}</span>
    </div>
    <MultiSelect v-model="form.variables" :options="variableOptions" option-label="label" option-value="value" display="chip" fluid />
  </section>
</template>

<script setup>
import DatePicker from "primevue/datepicker";
import InputNumber from "primevue/inputnumber";
import MultiSelect from "primevue/multiselect";
import Select from "primevue/select";
import DownloadArea from "../Area.vue";

defineOptions({ inheritAttrs: false });

defineProps({
  form: { type: Object, required: true },
  text: { type: Object, required: true },
  requestSummary: { type: String, default: "" },
  categoryLabel: { type: String, required: true },
  categoryOptions: { type: Array, default: () => [] },
  timeOptions: { type: Array, default: () => [] },
  showDepth: { type: Boolean, default: false },
  variableOptions: { type: Array, default: () => [] },
  areaLimits: { type: Object, required: true },
  areaPresets: { type: Array, default: () => [] }
});

defineEmits(["apply-area-preset"]);
</script>

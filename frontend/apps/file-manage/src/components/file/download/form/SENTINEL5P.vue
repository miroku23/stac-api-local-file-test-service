<template>
  <section class="form-section">
    <div class="section-title">
      <h2>{{ text.dataSelection }}</h2>
      <div class="section-actions">
        <Button size="small" severity="secondary" outlined :loading="datasetLoading" type="button" label="Dataset" @click="$emit('open-dataset')">
          <template #icon><i class="material-symbols-rounded icon">dataset</i></template>
        </Button>
        <span>{{ requestSummary }}</span>
      </div>
    </div>

    <div class="form-grid">
      <label class="field">
        <span>Date</span>
        <DatePicker v-model="form.date" date-format="yy-mm-dd" show-icon fluid />
      </label>
      <label class="field">
        <span>{{ categoryLabel }}</span>
        <Select v-model="form.category" :options="categoryOptions" option-label="label" option-value="value" fluid />
      </label>
      <label v-if="detailOptions.length" class="field">
        <span>{{ detailLabel }}</span>
        <Select v-model="form.detail" :options="detailOptions" option-label="label" option-value="value" fluid />
      </label>
      <label class="field">
        <span>{{ resolutionLabel }}</span>
        <Select v-model="form.resolution" :options="resolutionOptions" option-label="label" option-value="value" fluid />
      </label>
    </div>

    <p v-if="form.datasetShortName" class="section-note">
      {{ text.selectedDataset }}: {{ form.datasetShortName }}
    </p>
  </section>

  <DownloadArea :form="form" :text="text" :limits="areaLimits" :presets="areaPresets" @apply-preset="$emit('apply-area-preset', $event)" />
</template>

<script setup>
import Button from "primevue/button";
import DatePicker from "primevue/datepicker";
import Select from "primevue/select";
import DownloadArea from "../Area.vue";

defineOptions({ inheritAttrs: false });

defineProps({
  form: { type: Object, required: true },
  text: { type: Object, required: true },
  requestSummary: { type: String, default: "" },
  categoryLabel: { type: String, required: true },
  categoryOptions: { type: Array, default: () => [] },
  detailLabel: { type: String, required: true },
  detailOptions: { type: Array, default: () => [] },
  resolutionLabel: { type: String, required: true },
  resolutionOptions: { type: Array, default: () => [] },
  datasetLoading: { type: Boolean, default: false },
  areaLimits: { type: Object, required: true },
  areaPresets: { type: Array, default: () => [] }
});

defineEmits(["apply-area-preset", "open-dataset"]);
</script>

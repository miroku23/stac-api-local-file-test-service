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
        <span>{{ categoryLabel }}</span>
        <Select v-model="form.category" :options="categoryOptions" option-label="label" option-value="value" fluid />
      </label>
    </div>
  </section>
</template>

<script setup>
import DatePicker from "primevue/datepicker";
import Select from "primevue/select";

defineOptions({ inheritAttrs: false });

defineProps({
  form: { type: Object, required: true },
  text: { type: Object, required: true },
  requestSummary: { type: String, default: "" },
  categoryLabel: { type: String, required: true },
  categoryOptions: { type: Array, default: () => [] }
});
</script>

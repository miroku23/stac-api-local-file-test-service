<template>
  <Fieldset :legend="text.legend">
    <div class="grid gap-3">
      <div class="grid content-start gap-3">
        <div class="form-grid">
          <label class="field">
            <span>{{ text.resampling }}</span>
            <Select v-model="form.resampling" :options="resamplingOptions" option-label="label" option-value="value" class="w-full" />
          </label>
          <label class="field">
            <span>{{ text.crsTarget }}</span>
            <Select v-model="form.crsTarget" :options="crsOptions" option-label="label" option-value="value" class="w-full" />
          </label>
          <label class="field">
            <span>{{ text.dataType }}</span>
            <Select v-model="form.dataType" :options="dtypeOptions" option-label="label" option-value="value" class="w-full" />
          </label>
          <label class="field-check">
            <Checkbox v-model="form.pyramid" binary />
            <span>{{ text.pyramid }}</span>
          </label>
          <label class="field">
            <span>{{ text.chunkX }}</span>
            <InputNumber v-model="form.chunkSizeX" :min="64" :step="64" show-buttons fluid />
          </label>
          <label class="field">
            <span>{{ text.chunkY }}</span>
            <InputNumber v-model="form.chunkSizeY" :min="64" :step="64" show-buttons fluid />
          </label>
          <label v-if="form.pyramid" class="field">
            <span>{{ text.minLevel }}</span>
            <InputNumber v-model="form.levelMin" :min="report.strategy.minLevel" :max="form.levelMax" show-buttons fluid />
            <small class="text-[var(--zarr-muted)]">{{ text.minLevelHelp }}</small>
          </label>
          <label v-if="form.pyramid" class="field">
            <span>{{ text.maxLevel }}</span>
            <InputNumber v-model="form.levelMax" :min="form.levelMin" :max="report.strategy.maxLevel" show-buttons fluid />
            <small class="text-[var(--zarr-muted)]">{{ text.maxLevelHelp(report.strategy.suggestedMaxLevel, report.strategy.minLevel, report.strategy.maxLevel) }}</small>
          </label>
          <label class="field">
            <span>Consolidated metadata</span>
            <Select v-model="form.consolidated" :options="toggleOptions" option-label="label" option-value="value" class="w-full" />
          </label>
        </div>

        <div v-if="form.pyramid" class="grid gap-2 border border-orange-200 bg-orange-50 p-3 text-orange-900">
          <strong>{{ text.heavyControl }}</strong>
          <label class="flex items-center gap-2">
            <Checkbox v-model="form.executeSinglePass" binary />
            <span>{{ text.singlePass }}</span>
          </label>
          <span class="text-xs">{{ text.singlePassHelp }}</span>
        </div>

        <div class="grid gap-2 border border-slate-200 bg-slate-50 p-3">
          <label class="flex items-center gap-2">
            <Checkbox v-model="form.convertNan" binary />
            <span>{{ text.convertNan }}</span>
          </label>
        </div>

        <Fieldset :legend="text.fields">
          <Listbox
            v-if="productOptions.length"
            v-model="selectedProductsModel"
            :options="productOptions"
            multiple
            checkmark
            option-label="label"
            data-key="id"
            list-style="max-height: 260px"
            class="w-full"
          >
            <template #option="{ option }">
              <div class="min-w-0">
                <span class="block truncate font-semibold text-slate-700" :title="option.label">{{ option.label }}</span>
                <span class="block truncate text-xs text-slate-500" :title="option.kind">{{ option.kind }}</span>
              </div>
            </template>
          </Listbox>
          <span v-else class="text-xs text-[var(--zarr-muted)]">{{ text.noFields }}</span>
          <div v-if="productOptions.length" class="mt-2 flex justify-between gap-2">
            <span class="text-xs text-[var(--zarr-muted)]">{{ text.selectedCount(selectedProductsModel.length, productOptions.length) }}</span>
            <div class="flex gap-2">
              <Button text size="small" :label="text.selectAll" class="!px-0" @click="selectedProductsModel = [...productOptions]" />
              <Button text size="small" :label="text.clearAll" severity="secondary" class="!px-0" @click="selectedProductsModel = []" />
            </div>
          </div>
        </Fieldset>

        <label class="field">
          <span>{{ text.outputPath }}</span>
          <InputText v-model="form.outputPath" class="w-full" :placeholder="text.outputPlaceholder" />
        </label>

        <Fieldset :legend="text.result">
          <pre class="min-h-24 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-950 p-3 text-xs text-slate-100">{{ resultText }}</pre>
        </Fieldset>
      </div>

    </div>
  </Fieldset>
</template>

<script setup>
import { computed } from "vue";
import { useStore } from "vuex";
import Checkbox from "primevue/checkbox";
import Fieldset from "primevue/fieldset";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Listbox from "primevue/listbox";
import Select from "primevue/select";

const props = defineProps({
  form: { type: Object, required: true },
  report: { type: Object, required: true },
  productOptions: { type: Array, default: () => [] },
  selectedProducts: { type: Array, default: () => [] },
  resultText: { type: String, default: "" }
});

const emit = defineEmits(["update:selectedProducts"]);
const store = useStore();
const text = computed(() => store.getters.messages.convertSetting);

const selectedProductsModel = computed({
  get: () => props.selectedProducts,
  set: (value) => emit("update:selectedProducts", value)
});

const resamplingOptions = computed(() => [
  { label: text.value.options.average, value: "average" },
  { label: text.value.options.cubic, value: "cubic" },
  { label: text.value.options.nearest, value: "nearest" },
  { label: text.value.options.bilinear, value: "bilinear" }
]);
const crsOptions = computed(() => [
  { label: text.value.options.keepCrs, value: "keep" },
  { label: text.value.options.webMercator, value: "EPSG:3857" },
  { label: "EPSG:4326 (WGS84)", value: "EPSG:4326" }
]);
const dtypeOptions = computed(() => [
  { label: text.value.options.keepPrecision, value: "keep" },
  { label: "float32", value: "float32" },
  { label: "int16", value: "int16" }
]);
const toggleOptions = computed(() => [
  { label: text.value.options.enabled, value: true },
  { label: text.value.options.disabled, value: false }
]);
</script>

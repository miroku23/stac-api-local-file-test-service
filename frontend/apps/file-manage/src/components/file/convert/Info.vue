<template>
  <Fieldset :legend="text.legend" class="h-full">
    <div class="grid gap-3 text-xs">
      <div class="flex items-center justify-end">
        <Tag
          :severity="report.strategy.isHeavyPipeline ? 'danger' : 'success'"
          :value="report.strategy.isHeavyPipeline ? text.heavy : text.normal"
        />
      </div>

      <div class="grid gap-2 sm:grid-cols-2">
        <InfoItem :label="text.totalPixels" :value="report.dimensions.totalPixels ? `${report.dimensions.totalPixels.toLocaleString()} px` : '-'" strong />
        <InfoItem :label="text.gridLayout" :value="shapeText" />
        <InfoItem :label="text.timeLevel" :value="text.stepsLevels(report.dimensions.timeSteps, report.dimensions.levelSteps)" />
        <InfoItem :label="text.targetVariables" :value="text.count(report.variables.length)" />
        <InfoItem :label="text.dataType" :value="dataTypeText" />
        <InfoItem label="FillValue" :value="report.features.hasFillValue ? text.detected : text.missing" />
        <InfoItem label="CRS" :value="report.features.hasCrs ? text.metadataExists : text.needsReview" />
      </div>

      <div v-if="report.strategy.reasons.length" class="grid gap-1 border-l-4 border-orange-500 bg-orange-50 p-3 text-orange-800">
        <strong>{{ text.heavyReasons }}</strong>
        <span v-for="reason in report.strategy.reasons" :key="reason">- {{ reason }}</span>
      </div>
    </div>
  </Fieldset>
</template>

<script setup>
import { computed, defineComponent, h } from "vue";
import { useStore } from "vuex";
import Fieldset from "primevue/fieldset";
import Tag from "primevue/tag";

const props = defineProps({
  report: { type: Object, required: true }
});

const store = useStore();
const text = computed(() => store.getters.messages.convertInfo);
const shapeText = computed(() => {
  const { width, height } = props.report.dimensions;
  return width && height ? `${width.toLocaleString()} x ${height.toLocaleString()}` : "-";
});
const dataTypeText = computed(() => props.report.features.dataTypes?.length ? props.report.features.dataTypes.join(", ") : "-");

const InfoItem = defineComponent({
  props: {
    label: { type: String, required: true },
    value: { type: String, required: true },
    strong: { type: Boolean, default: false }
  },
  setup(itemProps) {
    return () => h("div", { class: "grid gap-1 rounded border border-slate-200 bg-slate-50 px-3 py-2" }, [
      h("span", { class: "text-xs font-bold text-slate-500" }, itemProps.label),
      h("span", { class: ["truncate text-sm text-slate-800", itemProps.strong ? "font-bold" : "font-semibold"], title: itemProps.value }, itemProps.value)
    ]);
  }
});
</script>

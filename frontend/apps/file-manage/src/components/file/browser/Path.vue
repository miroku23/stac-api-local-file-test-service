<template>
  <InputGroup class="min-w-0 flex-1">
    <InputText
      :model-value="modelValue"
      class="min-w-0"
      :placeholder="placeholder"
      :aria-label="label"
      :invalid="invalid"
      @update:model-value="updateValue"
    />
    <Button type="button" outlined severity="secondary" :label="buttonLabel" class="shrink-0" @click="pickPath">
      <template #icon>
        <i class="material-symbols-rounded icon">folder_open</i>
      </template>
    </Button>
  </InputGroup>
</template>

<script setup>
import Button from "primevue/button";
import InputGroup from "primevue/inputgroup";
import InputText from "primevue/inputtext";

defineProps({
  modelValue: { type: String, default: "" },
  label: { type: String, default: "Path" },
  placeholder: { type: String, default: "" },
  buttonLabel: { type: String, default: "Select folder" },
  invalid: { type: Boolean, default: false }
});

const emit = defineEmits(["update:modelValue", "pick"]);

function updateValue(value) {
  emit("update:modelValue", value);
}

function pickPath() {
  emit("pick");
}
</script>

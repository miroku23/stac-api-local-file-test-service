<template>
  <Button
    text
    class="!h-8 !w-8 !border-0 !bg-transparent !p-0 !text-white/85 hover:!bg-transparent hover:!text-white"
    :aria-label="messages.common.language"
    :title="currentLanguageLabel"
    @click="toggleLanguageMenu"
  >
    <template #icon>
      <i class="material-symbols-rounded icon !text-xl">language_korean_latin</i>
    </template>
  </Button>
  <Menu ref="languageMenuRef" :model="languageMenuItems" popup class="language-menu" />
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { usePrimeVue } from "primevue/config";
import Button from "primevue/button";
import Menu from "primevue/menu";

const store = useStore();
const primevue = usePrimeVue();
const languageMenuRef = ref(null);

const messages = computed(() => store.getters.messages);
const languageOptions = computed(() => store.getters.languageOptions);
const language = computed({
  get: () => store.getters.language,
  set: (value) => store.dispatch("setLanguage", value)
});
const currentLanguageLabel = computed(() => languageOptions.value.find((item) => item.value === language.value)?.label || messages.value.common.language);
const languageMenuItems = computed(() => languageOptions.value.map((item) => ({
  label: item.label,
  command: () => {
    language.value = item.value;
  }
})));

function toggleLanguageMenu(event) {
  languageMenuRef.value?.toggle(event);
}

watch(
  () => store.getters.primeVueLocale,
  (locale) => {
    primevue.config.locale = locale;
  },
  { immediate: true }
);
</script>
